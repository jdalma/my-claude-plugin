import Foundation

// A workspace's changes against its base branch: committed (`<base>...HEAD`) and uncommitted
// (`git diff HEAD` plus untracked paths). Read-only: git runs only through `git(_:_:in:)`.

/// The only git subcommands TowerCore may run. Read-only by construction.
enum GitRead: String, CaseIterable {
    case diff, lsFiles = "ls-files", mergeBase = "merge-base", revParse = "rev-parse"
    case symbolicRef = "symbolic-ref", forEachRef = "for-each-ref"
}

/// `-C dir` with the argument list as argv elements, never a shell. `--no-optional-locks` keeps
/// a status-like read from taking the index lock; `core.quotepath=off` (set through the environment,
/// so argv has no config flag) keeps paths unescaped.
func git(_ cmd: GitRead, _ args: [String], in dir: String) throws -> CommandResult {
    try runCommand(["git", "--no-optional-locks", "-C", dir, cmd.rawValue] + args,
                   timeout: 20, env: ["GIT_OPTIONAL_LOCKS": "0", "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.quotepath", "GIT_CONFIG_VALUE_0": "off"])
}

/// Stdout of a successful run; nil when git is missing or exits non-zero.
private func out(_ cmd: GitRead, _ args: [String], in dir: String) -> String? {
    guard let r = try? git(cmd, args, in: dir), r.status == 0 else { return nil }
    return r.stdout
}

public struct DiffLine: Hashable, Sendable {
    public enum Kind: Hashable, Sendable { case hunk, context, added, removed }
    public var kind: Kind
    public var old: Int?
    public var new: Int?
    /// The line without its `+`/`-`/space marker; the whole `@@ … @@` header for a hunk.
    public var text: String
}

public struct FileDiff: Hashable, Sendable {
    public var path: String
    public var added: Int
    public var removed: Int
    public var binary: Bool
    public var lines: [DiffLine]
}

public struct DiffSection: Hashable, Sendable {
    public var files: [FileDiff]
    public var untracked: [String]
    public var added: Int { files.reduce(0) { $0 + $1.added } }
    public var removed: Int { files.reduce(0) { $0 + $1.removed } }
}

public enum BaseChoice: Hashable, Sendable {
    case resolved(ref: String, mergeBase: String)
    /// The pinned base no longer exists. Never replaced by another base.
    case pinnedMissing(String)
    case none
}

public struct WorkspaceDiff: Hashable, Sendable {
    public var toplevel: String
    public var base: BaseChoice
    /// nil unless the base resolved.
    public var committed: DiffSection?
    public var uncommitted: DiffSection
    /// Diff lines cut by the line limit.
    public var hiddenLines: Int
}

public enum WorkspaceDiffResult: Hashable, Sendable {
    case notARepo
    case diff(WorkspaceDiff)
}

// MARK: - Entry points

public func repoToplevel(at path: String) -> String? {
    out(.revParse, ["--show-toplevel"], in: path)?.trimmed.nonEmpty
}

public func workspaceDiff(at path: String, pinnedBase: String?, lineLimit: Int = 2000) -> WorkspaceDiffResult {
    guard let top = repoToplevel(at: path) else { return .notARepo }
    let base = resolveBase(top: top, pinned: pinnedBase)
    var budget = lineLimit
    var hidden = 0

    var committed: DiffSection?
    if case .resolved(let ref, _) = base {
        let files = cap(parseUnifiedDiff(diffText(["\(ref)...HEAD"], top)), budget: &budget, hidden: &hidden)
        committed = DiffSection(files: files, untracked: [])
    }
    let files = cap(parseUnifiedDiff(diffText(["HEAD"], top)), budget: &budget, hidden: &hidden)
    let untracked = (out(.lsFiles, ["--others", "--exclude-standard", "-z"], in: top) ?? "")
        .split(separator: "\0").map(String.init)
    return .diff(WorkspaceDiff(toplevel: top, base: base, committed: committed,
                               uncommitted: DiffSection(files: files, untracked: untracked), hiddenLines: hidden))
}

/// Local heads and remote-tracking branches, for the base picker. Never `origin/HEAD`.
public func baseCandidates(toplevel: String) -> [String] {
    let refs = (out(.forEachRef, ["--format=%(refname)", "refs/heads", "refs/remotes"], in: toplevel) ?? "")
        .split(separator: "\n").map(String.init)
    return refs.compactMap { ref in
        if let b = ref.stripPrefix("refs/heads/") { return b }
        guard let r = ref.stripPrefix("refs/remotes/"), !r.hasSuffix("/HEAD") else { return nil }
        return r
    }.sorted()
}

private extension String {
    func stripPrefix(_ p: String) -> String? { hasPrefix(p) ? String(dropFirst(p.count)) : nil }
}

// MARK: - Base resolution

private func diffText(_ revs: [String], _ top: String) -> String {
    out(.diff, ["--no-color", "--no-ext-diff", "--no-textconv", "-M", "--src-prefix=a/", "--dst-prefix=b/"] + revs + ["--"], in: top) ?? ""
}

private func hasRef(_ full: String, _ top: String) -> Bool {
    out(.revParse, ["--verify", "--quiet", "\(full)^{commit}"], in: top) != nil
}

private func mergeBase(_ ref: String, _ top: String) -> String? {
    out(.mergeBase, ["HEAD", ref], in: top)?.trimmed.nonEmpty
}

/// Pinned base first and final; else origin/HEAD's branch, `main`, `master`.
func resolveBase(top: String, pinned: String?) -> BaseChoice {
    if let pinned {
        if let b = pickNamed(pinned, top) { return b }
        if hasRef("refs/remotes/\(pinned)", top), let mb = mergeBase(pinned, top) { return .resolved(ref: pinned, mergeBase: mb) }
        return .pinnedMissing(pinned)
    }
    let head = out(.symbolicRef, ["--quiet", "refs/remotes/origin/HEAD"], in: top)?.trimmed.stripPrefix("refs/remotes/origin/")
    for name in [head, "main", "master"].compactMap({ $0 }) {
        if let b = pickNamed(name, top) { return b }
    }
    return .none
}

/// A branch name `b` exists as `refs/heads/b` and/or `refs/remotes/origin/b`. With both, the ref
/// whose merge-base with HEAD is newer wins; a tie goes to the local one.
private func pickNamed(_ b: String, _ top: String) -> BaseChoice? {
    let local = hasRef("refs/heads/\(b)", top) ? mergeBase(b, top) : nil
    let remote = hasRef("refs/remotes/origin/\(b)", top) ? mergeBase("origin/\(b)", top) : nil
    switch (local, remote) {
    case (let l?, let r?):
        let remoteNewer = l != r && out(.mergeBase, ["--is-ancestor", l, r], in: top) != nil
        return remoteNewer ? .resolved(ref: "origin/\(b)", mergeBase: r) : .resolved(ref: b, mergeBase: l)
    case (let l?, nil): return .resolved(ref: b, mergeBase: l)
    case (nil, let r?): return .resolved(ref: "origin/\(b)", mergeBase: r)
    case (nil, nil): return nil
    }
}

// MARK: - Cap

/// Keeps at most `budget` more lines across files, in order; counts and files stay whole.
private func cap(_ files: [FileDiff], budget: inout Int, hidden: inout Int) -> [FileDiff] {
    var result: [FileDiff] = []
    for var f in files {
        if f.lines.count > budget {
            hidden += f.lines.count - budget
            f.lines = Array(f.lines.prefix(budget))
        }
        budget -= f.lines.count
        result.append(f)
    }
    return result
}

// MARK: - Parser

/// Parses `git diff` output (unified, no color, `a/` `b/` prefixes). Line numbers come from hunk headers.
func parseUnifiedDiff(_ text: String) -> [FileDiff] {
    var files: [FileDiff] = []
    var cur: FileDiff?
    var inHunk = false
    var old = 0, new = 0

    for line in text.components(separatedBy: "\n") {
        if let rest = line.stripPrefix("diff --git a/") {
            if let f = cur { files.append(f) }
            cur = FileDiff(path: headerPath(rest), added: 0, removed: 0, binary: false, lines: [])
            inHunk = false
            continue
        }
        guard cur != nil, !line.isEmpty else { continue }
        if line.hasPrefix("@@ ") {
            (old, new) = hunkStarts(line)
            cur?.lines.append(DiffLine(kind: .hunk, old: nil, new: nil, text: line))
            inHunk = true
        } else if inHunk {
            switch line.first {
            case "+":
                cur?.lines.append(DiffLine(kind: .added, old: nil, new: new, text: String(line.dropFirst())))
                cur?.added += 1
                new += 1
            case "-":
                cur?.lines.append(DiffLine(kind: .removed, old: old, new: nil, text: String(line.dropFirst())))
                cur?.removed += 1
                old += 1
            case " ":
                cur?.lines.append(DiffLine(kind: .context, old: old, new: new, text: String(line.dropFirst())))
                old += 1
                new += 1
            default: break  // "\ No newline at end of file"
            }
        } else if let p = line.stripPrefix("rename to ") {
            cur?.path = p
        } else if let p = line.stripPrefix("+++ b/") {
            cur?.path = p.hasSuffix("\t") ? String(p.dropLast()) : p
        } else if line.hasPrefix("Binary files ") {
            cur?.binary = true
        }
    }
    if let f = cur { files.append(f) }
    return files
}

/// `P b/P` (same path both sides) or `old b/new`; renames and text files are corrected by later headers.
private func headerPath(_ rest: String) -> String {
    let n = rest.count
    if (n - 3) % 2 == 0, n >= 3 {
        let p = rest.prefix((n - 3) / 2)
        if rest == "\(p) b/\(p)" { return String(p) }
    }
    return rest.range(of: " b/").map { String(rest[$0.upperBound...]) } ?? rest
}

/// `@@ -12,3 +14,4 @@ …` → (12, 14).
private func hunkStarts(_ header: String) -> (Int, Int) {
    let parts = header.split(separator: " ")
    func start(_ s: Substring) -> Int { Int(s.dropFirst().split(separator: ",").first ?? "") ?? 0 }
    return parts.count >= 3 ? (start(parts[1]), start(parts[2])) : (0, 0)
}
