import Foundation
import Testing
@testable import TowerCore

// MARK: - Fixture repos

private let isolation = ["GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1"]

@discardableResult
private func sh(_ dir: String, _ args: [String]) throws -> String {
    let r = try runCommand(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", dir] + args, timeout: 30, env: isolation)
    #expect(r.status == 0, "git \(args) failed: \(r.stderr)")
    return r.stdout.trimmed
}

private func write(_ dir: String, _ file: String, _ content: String) throws {
    try content.write(toFile: "\(dir)/\(file)", atomically: true, encoding: .utf8)
}

private func commit(_ dir: String, _ file: String, _ content: String, _ msg: String = "c") throws {
    try write(dir, file, content)
    try sh(dir, ["add", "-A"])
    try sh(dir, ["commit", "-q", "-m", msg])
}

/// A temp directory; a repo on `main` with one commit when `repo`.
private func fixture(repo: Bool = true) throws -> String {
    let url = FileManager.default.temporaryDirectory.appending(path: "diff-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    // /var/folders is a symlink to /private/var and git reports the real path
    let dir = String(cString: realpath(url.path, nil))
    if repo {
        try sh(dir, ["init", "-q", "-b", "main"])
        try commit(dir, "a.txt", "1\n2\n3\n4\n5\n", "base")
        try write(dir, "b.txt", "x\ny\n")
        try sh(dir, ["add", "-A"])
        try sh(dir, ["commit", "-q", "-m", "b"])
    }
    return dir
}

private func result(_ dir: String, pinned: String? = nil, limit: Int = 2000) throws -> WorkspaceDiff {
    guard case .diff(let d) = workspaceDiff(at: dir, pinnedBase: pinned, lineLimit: limit) else {
        Issue.record("expected a repo at \(dir)")
        throw CommandError(description: "not a repo")
    }
    return d
}

private func baseRef(_ d: WorkspaceDiff) -> String? {
    if case .resolved(let ref, _) = d.base { ref } else { nil }
}

// MARK: - Acceptance 2

@Test func committedUncommittedAndUntrackedAreSeparated() throws {
    let dir = try fixture()
    let fork = try sh(dir, ["rev-parse", "HEAD"])
    try sh(dir, ["switch", "-q", "-c", "feature"])
    try commit(dir, "a.txt", "1\n2\nTHREE\n4\n5\n")
    try commit(dir, "c.txt", "new\n")
    try write(dir, "b.txt", "x\ny\nz\n")
    try write(dir, "n.txt", "untracked\n")

    let d = try result(dir)
    #expect(d.toplevel == dir)
    #expect(d.base == .resolved(ref: "main", mergeBase: fork))
    let committed = try #require(d.committed)
    #expect(committed.files.map(\.path) == ["a.txt", "c.txt"])
    #expect(committed.added == 2 && committed.removed == 1)
    #expect(d.uncommitted.files.map(\.path) == ["b.txt"])
    #expect(d.uncommitted.added == 1 && d.uncommitted.removed == 0)
    #expect(d.uncommitted.untracked == ["n.txt"])
    #expect(d.hiddenLines == 0)
}

@Test func originHeadNamesTheBase() throws {
    let dir = try fixture()
    try sh(dir, ["branch", "develop"])
    try sh(dir, ["update-ref", "refs/remotes/origin/develop", "develop"])
    try sh(dir, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop"])
    #expect(baseRef(try result(dir)) == "develop")
}

@Test func mainWithoutOriginHeadIsTheBaseAndMasterIsTheFallback() throws {
    let dir = try fixture()
    #expect(baseRef(try result(dir)) == "main")
    try sh(dir, ["branch", "-m", "main", "master"])
    #expect(baseRef(try result(dir)) == "master")
}

@Test func theNewerMergeBaseWinsBetweenLocalAndOrigin() throws {
    let behind = try fixture()
    try sh(behind, ["switch", "-q", "-c", "feature"])
    try commit(behind, "a.txt", "changed\n")
    try sh(behind, ["update-ref", "refs/remotes/origin/main", "HEAD"])
    try sh(behind, ["switch", "-q", "-c", "work"])
    try commit(behind, "w.txt", "w\n")
    #expect(baseRef(try result(behind)) == "origin/main")

    let ahead = try fixture()
    try sh(ahead, ["branch", "old"])
    try sh(ahead, ["update-ref", "refs/remotes/origin/main", "old"])
    try sh(ahead, ["switch", "-q", "-c", "work"])
    try commit(ahead, "w.txt", "w\n")
    #expect(baseRef(try result(ahead)) == "main")
}

@Test func aPinnedBaseThatIsGoneIsReportedNotReplaced() throws {
    let dir = try fixture()
    try sh(dir, ["branch", "gone"])
    #expect(baseRef(try result(dir, pinned: "gone")) == "gone")
    try sh(dir, ["branch", "-D", "gone"])
    let d = try result(dir, pinned: "gone")
    #expect(d.base == .pinnedMissing("gone"))
    #expect(d.committed == nil)
}

@Test func aPinnedRemoteTrackingBaseIsUsedAsIs() throws {
    let dir = try fixture()
    try sh(dir, ["update-ref", "refs/remotes/origin/develop", "main"])
    #expect(baseRef(try result(dir, pinned: "origin/develop")) == "origin/develop")
}

@Test func noBaseLeavesCommittedOutAndUncommittedIntact() throws {
    let dir = try fixture()
    try sh(dir, ["branch", "-m", "main", "trunk"])
    try write(dir, "b.txt", "changed\n")
    let d = try result(dir)
    #expect(d.base == .none)
    #expect(d.committed == nil)
    #expect(d.uncommitted.files.map(\.path) == ["b.txt"])
}

@Test func onTheBaseBranchCommittedIsEmpty() throws {
    let dir = try fixture()
    try write(dir, "b.txt", "changed\n")
    let d = try result(dir)
    #expect(d.committed == DiffSection(files: [], untracked: []))
    #expect(d.uncommitted.files.map(\.path) == ["b.txt"])
}

@Test func notARepo() throws {
    let plain = try fixture(repo: false)
    #expect(workspaceDiff(at: plain, pinnedBase: nil) == .notARepo)
    #expect(workspaceDiff(at: plain + "/missing", pinnedBase: nil) == .notARepo)
}

@Test func linesBeyondTheLimitAreCutAndCounted() throws {
    let dir = try fixture()
    try sh(dir, ["switch", "-q", "-c", "feature"])
    try commit(dir, "big.txt", (1...3000).map { "line \($0)\n" }.joined())
    try write(dir, "a.txt", "1\n2\nTHREE\n4\n5\n")

    let full = try result(dir, limit: 100_000)
    let total = (full.committed?.files ?? []).flatMap(\.lines).count + full.uncommitted.files.flatMap(\.lines).count
    #expect(total > 3000 && full.hiddenLines == 0)

    let d = try result(dir)
    let kept = (d.committed?.files ?? []).flatMap(\.lines).count + d.uncommitted.files.flatMap(\.lines).count
    #expect(kept == 2000)
    #expect(d.hiddenLines == total - 2000)
    #expect(d.committed?.files.first?.added == 3000)
    #expect(d.uncommitted.files.map(\.path) == ["a.txt"])
}

@Test func binaryFilesHaveNoLines() throws {
    let dir = try fixture()
    try sh(dir, ["switch", "-q", "-c", "feature"])
    try Data([0, 1, 2, 0xff, 0]).write(to: URL(fileURLWithPath: "\(dir)/img.bin"))
    try sh(dir, ["add", "-A"])
    try sh(dir, ["commit", "-q", "-m", "bin"])
    let f = try #require(try result(dir).committed?.files.first)
    #expect(f.path == "img.bin" && f.binary && f.lines.isEmpty && f.added == 0)
}

@Test func candidatesAreHeadsAndRemoteTrackingWithoutOriginHead() throws {
    let dir = try fixture()
    try sh(dir, ["branch", "feature/x"])
    try sh(dir, ["update-ref", "refs/remotes/origin/develop", "main"])
    try sh(dir, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop"])
    #expect(baseCandidates(toplevel: dir) == ["feature/x", "main", "origin/develop"])
}

// MARK: - Parser and safety

@Test func parserNumbersLinesFromHunkHeadersAndReadsRenamesAndBinaries() {
    let text = """
    diff --git a/src/a b.txt b/src/a b.txt
    index 111..222 100644
    --- a/src/a b.txt
    +++ b/src/a b.txt
    @@ -3,3 +3,4 @@ func f()
     keep
    -gone
    +new1
    +new2
     tail
    @@ -20 +21 @@
    -x
    +y
    \\ No newline at end of file
    diff --git a/old.txt b/new.txt
    similarity index 100%
    rename from old.txt
    rename to new.txt
    diff --git a/img.png b/img.png
    index 111..222 100644
    Binary files a/img.png and b/img.png differ

    """
    let files = parseUnifiedDiff(text)
    #expect(files.map(\.path) == ["src/a b.txt", "new.txt", "img.png"])
    #expect(files[0].added == 3 && files[0].removed == 2)
    #expect(files[0].lines.map(\.kind) == [.hunk, .context, .removed, .added, .added, .context, .hunk, .removed, .added])
    #expect(files[0].lines[1...5].map { [$0.old, $0.new] } == [[3, 3], [4, nil], [nil, 4], [nil, 5], [5, 6]])
    #expect(files[0].lines[7].old == 20 && files[0].lines[8].new == 21)
    #expect(files[0].lines[2].text == "gone")
    #expect(files[1].lines.isEmpty && !files[1].binary)
    #expect(files[2].binary && files[2].lines.isEmpty)
}

@Test func gitRunsOnlyTheSixReadOnlySubcommands() {
    #expect(Set(GitRead.allCases.map(\.rawValue)) == ["diff", "ls-files", "merge-base", "rev-parse", "symbolic-ref", "for-each-ref"])
}
