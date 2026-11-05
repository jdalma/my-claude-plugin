import Foundation

// Java/Kotlin type declarations of a workspace, for Command-click to a type's definition. A byte scan,
// not a parser: package, imports and type declarations, with comments and strings skipped.

public struct TypeDecl: Hashable, Sendable {
    public var name: String
    /// Package, enclosing types and the name, dot separated.
    public var qualified: String
    public var line: Int
    /// Character offset of the name in its line.
    public var column: Int
}

public struct ImportDecl: Hashable, Sendable {
    /// `a.b.C`, or the package `a.b` of a wildcard import.
    public var path: String
    public var alias: String?
    public var wildcard: Bool
}

public struct SourceFacts: Hashable, Sendable {
    public var package = ""
    public var imports: [ImportDecl] = []
    public var types: [TypeDecl] = []
}

private let declKeywords: Set = ["class", "interface", "object", "typealias", "enum"]
/// A word after a declaration keyword that is another keyword, not a name: `enum class`, `fun interface`'s neighbors.
private let notNames: Set = ["class", "interface", "object", "fun", "enum"]
/// A header continued on the next line: `class A\n    : B {`, Java's `extends` on its own line.
private let continuations: Set = ["extends", "implements", "where", "permits"]

private func isIdent(_ c: UInt8) -> Bool {
    c >= 0x80 || c == UInt8(ascii: "_") || c == UInt8(ascii: "$") || (48...57).contains(c) || (97...122).contains(c | 0x20)
}

private func isIdentStart(_ c: UInt8) -> Bool { isIdent(c) && !(48...57).contains(c) }

/// The package, imports and type declarations of one source file. Declarations inside comments and
/// strings are ignored. A type's body is the first `{` outside parentheses after its name; a header that
/// ends a line without one has no body unless the next line continues it (`{`, `:`, `,`, `extends` …).
/// Kotlin block comments nest, Java's do not. Java alone has `record`.
public func scanSource(_ text: String, java: Bool) -> SourceFacts {
    let b = Array(text.utf8), n = b.count
    var facts = SourceFacts()
    var i = 0, line = 1, lineStart = 0
    var depth = 0, parens = 0
    var stack: [(name: String, depth: Int)] = []
    var pending: String?
    var checkPending = false, lineHasToken = false
    var last: UInt8 = 0
    let keywords = java ? declKeywords.union(["record"]) : declKeywords

    func byte(_ k: Int) -> UInt8 { k < n ? b[k] : 0 }
    func identEnd(_ k: Int) -> Int {
        var e = k
        while e < n, isIdent(b[e]) { e += 1 }
        return e
    }
    func word(_ r: Range<Int>) -> String { String(decoding: b[r], as: UTF8.self) }
    func newline(at k: Int) {
        line += 1
        lineStart = k + 1
        lineHasToken = false
    }
    func lineRest(from k: Int) -> (String, Int) {
        var e = k
        while e < n, b[e] != UInt8(ascii: "\n") { e += 1 }
        return (word(k..<e), e)
    }

    while i < n {
        let c = b[i]
        if c == UInt8(ascii: "\n") {
            if pending != nil, parens == 0, last != UInt8(ascii: ":"), last != UInt8(ascii: ",") { checkPending = true }
            newline(at: i)
            i += 1
            continue
        }
        if c == UInt8(ascii: " ") || c == UInt8(ascii: "\t") || c == UInt8(ascii: "\r") { i += 1; continue }
        if c == UInt8(ascii: "/"), byte(i + 1) == UInt8(ascii: "/") {
            while i < n, b[i] != UInt8(ascii: "\n") { i += 1 }
            continue
        }
        if c == UInt8(ascii: "/"), byte(i + 1) == UInt8(ascii: "*") {
            var nest = 1
            i += 2
            while i < n, nest > 0 {
                if b[i] == UInt8(ascii: "*"), byte(i + 1) == UInt8(ascii: "/") { nest -= 1; i += 2; continue }
                if !java, b[i] == UInt8(ascii: "/"), byte(i + 1) == UInt8(ascii: "*") { nest += 1; i += 2; continue }
                if b[i] == UInt8(ascii: "\n") { newline(at: i) }
                i += 1
            }
            continue
        }
        if checkPending, !lineHasToken {
            checkPending = false
            let first = isIdentStart(c) ? word(i..<identEnd(i)) : ""
            let keep = c == UInt8(ascii: "{") || c == UInt8(ascii: ":") || c == UInt8(ascii: ",") || continuations.contains(first)
            if !keep { pending = nil }
        }
        let firstOnLine = !lineHasToken
        lineHasToken = true

        if c == UInt8(ascii: "\"") {
            if byte(i + 1) == UInt8(ascii: "\""), byte(i + 2) == UInt8(ascii: "\"") {
                i += 3
                while i < n, !(b[i] == UInt8(ascii: "\"") && byte(i + 1) == UInt8(ascii: "\"") && byte(i + 2) == UInt8(ascii: "\"")) {
                    if b[i] == UInt8(ascii: "\n") { newline(at: i) }
                    i += 1
                }
                i += 3
            } else {
                i += 1
                while i < n, b[i] != UInt8(ascii: "\""), b[i] != UInt8(ascii: "\n") { i += b[i] == UInt8(ascii: "\\") ? 2 : 1 }
                if byte(i) == UInt8(ascii: "\"") { i += 1 }
            }
            last = UInt8(ascii: "\"")
            continue
        }
        if c == UInt8(ascii: "'") {
            // a char literal, 'A' at most; a lone quote is left as is
            var j = i + 1
            while j < n, j < i + 9, b[j] != UInt8(ascii: "'"), b[j] != UInt8(ascii: "\n") { j += b[j] == UInt8(ascii: "\\") ? 2 : 1 }
            i = byte(j) == UInt8(ascii: "'") ? j + 1 : i + 1
            last = UInt8(ascii: "'")
            continue
        }
        switch c {
        case UInt8(ascii: "{"):
            if let p = pending, parens == 0 { stack.append((p, depth + 1)) }
            pending = nil
            depth += 1
        case UInt8(ascii: "}"):
            if stack.last?.depth == depth { stack.removeLast() }
            depth = max(0, depth - 1)
        case UInt8(ascii: "("): parens += 1
        case UInt8(ascii: ")"): parens = max(0, parens - 1)
        case UInt8(ascii: ";"): if parens == 0 { pending = nil }
        default: break
        }
        guard isIdentStart(c) else {
            last = c
            i += 1
            continue
        }
        let end = identEnd(i)
        let w = word(i..<end)
        if firstOnLine, depth == 0, w == "package" || w == "import" {
            let (rest, e) = lineRest(from: end)
            if w == "package" {
                facts.package = String(rest.drop { $0 == " " }.prefix { $0.isLetter || $0.isNumber || "_$.".contains($0) })
            } else if let imp = parseImport(rest) {
                facts.imports.append(imp)
            }
            i = e
            continue
        }
        if keywords.contains(w), last != UInt8(ascii: "."), last != UInt8(ascii: ":") {
            var k = end
            while k < n, b[k] == UInt8(ascii: " ") || b[k] == UInt8(ascii: "\t") { k += 1 }
            let nameEnd = identEnd(k)
            if k < n, isIdentStart(b[k]), !notNames.contains(word(k..<nameEnd)) {
                let name = word(k..<nameEnd)
                let qualified = ([facts.package] + stack.map(\.name) + [name]).filter { !$0.isEmpty }.joined(separator: ".")
                facts.types.append(TypeDecl(name: name, qualified: qualified, line: line,
                                            column: String(decoding: b[lineStart..<k], as: UTF8.self).count))
                pending = w == "typealias" ? nil : name
                last = b[nameEnd - 1]
                i = nameEnd
                continue
            }
        }
        last = b[end - 1]
        i = end
    }
    return facts
}

/// ` a.b.C`, ` static a.b.c`, ` a.b.*;`, ` a.b.C as D` after `import`.
private func parseImport(_ rest: String) -> ImportDecl? {
    var words = rest.replacingOccurrences(of: ";", with: " ").split(separator: " ").map(String.init)
    if words.first == "static" { words.removeFirst() }
    guard var path = words.first, !path.isEmpty else { return nil }
    let alias = words.count >= 3 && words[1] == "as" ? words[2] : nil
    let wildcard = path.hasSuffix(".*")
    if wildcard { path.removeLast(2) }
    return ImportDecl(path: path, alias: alias, wildcard: wildcard)
}

/// Where a Command-clicked type name leads.
public enum TypeTarget: Hashable, Sendable {
    case found(CodeLocation)
    /// More than one declaration fits; sorted.
    case many([CodeLocation])
    case none
}

/// Every scanned file of a workspace, looked up by simple and by qualified type name.
public struct DeclIndex: Sendable {
    public let files: [String: SourceFacts]
    private let byName: [String: [Ref]]
    private let byQualified: [String: [Ref]]

    private struct Ref: Hashable, Sendable {
        var path: String
        var decl: TypeDecl
    }

    public init(files: [String: SourceFacts]) {
        self.files = files
        let refs = files.flatMap { path, f in f.types.map { Ref(path: path, decl: $0) } }
        byName = Dictionary(grouping: refs, by: \.decl.name)
        byQualified = Dictionary(grouping: refs, by: \.decl.qualified)
    }

    /// `name`'s segments (`["a", "b", "C"]` for `a.b.C`) as written in `path`. A dotted name is first
    /// a qualified name; else its first segment resolves as a simple name and the rest are nested types
    /// in it; else the last segment alone. A simple name: (a) this file, (b) an explicit import or its
    /// alias, which is final even when the type is outside the workspace, (c) this file's package,
    /// (d) wildcard imports, (e) the one type of that name in the workspace.
    public func resolve(_ name: [String], in path: String) -> TypeTarget {
        guard let head = name.first else { return .none }
        let facts = files[path] ?? SourceFacts()
        if name.count == 1 { return target(simple(head, facts, path)) }
        if let q = byQualified[name.joined(separator: ".")] { return target(q) }
        let rest = name.dropFirst().joined(separator: ".")
        let nested = simple(head, facts, path).flatMap { byQualified[$0.decl.qualified + "." + rest] ?? [] }
        return target(nested.isEmpty ? simple(name[name.count - 1], facts, path) : nested)
    }

    private func simple(_ n: String, _ facts: SourceFacts, _ path: String) -> [Ref] {
        let here = facts.types.filter { $0.name == n }
        if !here.isEmpty { return here.map { Ref(path: path, decl: $0) } }
        let explicit = facts.imports.filter { !$0.wildcard && ($0.alias ?? $0.path.split(separator: ".").last.map(String.init)) == n }
        if !explicit.isEmpty { return explicit.flatMap { byQualified[$0.path] ?? [] } }
        if let same = byQualified[facts.package.isEmpty ? n : facts.package + "." + n] { return same }
        let wild = facts.imports.filter(\.wildcard).flatMap { byQualified[$0.path + "." + n] ?? [] }
        if !wild.isEmpty { return wild }
        return byName[n] ?? []
    }

    private func target(_ refs: [Ref]) -> TypeTarget {
        let locations = Set(refs.map { CodeLocation(path: $0.path, line: $0.decl.line) })
            .sorted { ($0.path, $0.line) < ($1.path, $1.line) }
        switch locations.count {
        case 0: return .none
        case 1: return .found(locations[0])
        default: return .many(locations)
        }
    }
}

/// The dotted name ending at the identifier under `offset`: `["a", "b", "C"]` for a click on `C` of
/// `a.b.C`, `["a", "b"]` for one on `b`.
public func dottedName(in line: String, at offset: Int) -> [String]? {
    guard let w = identifier(in: line, at: offset) else { return nil }
    let chars = Array(line)
    var parts = [w.name], lo = w.range.lowerBound
    while lo >= 2, chars[lo - 1] == ".", let prev = identifier(in: line, at: lo - 2) {
        parts.insert(prev.name, at: 0)
        lo = prev.range.lowerBound
    }
    return parts
}

private let sourceExtensions: Set = ["kt", "kts", "java"]

/// Each workspace's index, kept between clicks. A lookup lists the files (`git ls-files -co
/// --exclude-standard`) and rescans only those whose size or modification time changed.
public final class DeclIndexCache: @unchecked Sendable {
    private struct Stamp: Equatable {
        var size: Int64
        var seconds: Int
        var nanoseconds: Int
    }

    private struct Repo {
        var stamps: [String: Stamp] = [:]
        var facts: [String: SourceFacts] = [:]
        var index = DeclIndex(files: [:])
    }

    private let lock = NSLock()
    private var repos: [String: Repo] = [:]
    /// Files scanned so far, by tests only.
    private(set) var scans = 0

    public init() {}

    public func index(toplevel: String) -> DeclIndex {
        let paths = (out(.lsFiles, ["-co", "--exclude-standard", "-z"], in: toplevel) ?? "")
            .split(separator: "\0").map(String.init)
            .filter { sourceExtensions.contains(($0 as NSString).pathExtension) }
        return lock.withLock {
            var repo = repos[toplevel] ?? Repo()
            var stamps: [String: Stamp] = [:], facts: [String: SourceFacts] = [:]
            for p in paths {
                var st = stat()
                let full = toplevel + "/" + p
                guard stat(full, &st) == 0, (st.st_mode & S_IFMT) == S_IFREG else { continue }
                let stamp = Stamp(size: st.st_size, seconds: st.st_mtimespec.tv_sec, nanoseconds: st.st_mtimespec.tv_nsec)
                stamps[p] = stamp
                if repo.stamps[p] == stamp, let f = repo.facts[p] {
                    facts[p] = f
                } else if let text = try? String(contentsOfFile: full, encoding: .utf8) {
                    scans += 1
                    facts[p] = scanSource(text, java: p.hasSuffix(".java"))
                }
            }
            if stamps != repo.stamps || facts.count != repo.facts.count {
                repo = Repo(stamps: stamps, facts: facts, index: DeclIndex(files: facts))
                repos[toplevel] = repo
            }
            return repo.index
        }
    }
}

public let declIndexCache = DeclIndexCache()
