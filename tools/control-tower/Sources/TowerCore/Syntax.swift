import Foundation
import JavaScriptCore

/// GitHub's syntax color roles (Primer `prettylights-syntax-*`). highlight.js scopes map onto them
/// as highlight.js's own styles/github.css does.
public enum SyntaxKind: Hashable, Sendable {
    case keyword, entity, constant, string, variable, comment, entityTag, heading, list
}

/// A colored run of a line, in Character offsets of `DiffLine.text`.
public struct SyntaxSpan: Hashable, Sendable {
    public var range: Range<Int>
    public var kind: SyntaxKind

    public init(range: Range<Int>, kind: SyntaxKind) {
        self.range = range
        self.kind = kind
    }
}

private let languages = [
    "swift": "swift", "ts": "typescript", "tsx": "typescript", "mts": "typescript", "cts": "typescript",
    "js": "javascript", "jsx": "javascript", "mjs": "javascript", "cjs": "javascript", "py": "python",
    "sh": "bash", "bash": "bash", "zsh": "bash", "json": "json", "md": "markdown", "markdown": "markdown",
    "yml": "yaml", "yaml": "yaml",
]

/// The highlight.js language for a path, by extension; nil leaves the file one color.
public func syntaxLanguage(forPath path: String) -> String? {
    languages[(path as NSString).pathExtension.lowercased()]
}

/// The one JavaScriptCore context, used only from this actor. nil function: the script failed to load,
/// and every file stays one color.
public actor SyntaxHighlighter {
    public static let shared = SyntaxHighlighter(source: bundledScript())

    private let context = JSContext()
    private let highlightLines: JSValue?

    init(source: String?) {
        guard let context, let source else { highlightLines = nil; return }
        context.evaluateScript(source)
        // Lines arrive as an argument; nothing from a diff is ever part of script text.
        let fn = context.evaluateScript("""
            (function (lines, lang) {
                return lines.map(function (l) { return hljs.highlight(l, {language: lang, ignoreIllegals: true}).value })
            })
            """)
        highlightLines = context.exception == nil && fn?.isObject == true ? fn : nil
        context.exception = nil
    }

    /// Spans per line, each line highlighted on its own so a multi-line string or comment cut by a hunk
    /// can only miscolor its own line. nil on any script error.
    public func spans(_ lines: [String], language: String) -> [[SyntaxSpan]]? {
        guard let context, let highlightLines else { return nil }
        let result = highlightLines.call(withArguments: [lines, language])
        defer { context.exception = nil }
        guard context.exception == nil, let html = result?.toArray() as? [String], html.count == lines.count else { return nil }
        return zip(html, lines).map { syntaxSpans(html: $0, line: $1) }
    }
}

/// The app copies the script into Contents/Resources; tests read it from the SwiftPM resource bundle.
private func bundledScript() -> String? {
    let url = Bundle.main.url(forResource: "highlight.min", withExtension: "js")
        ?? Bundle.module.url(forResource: "highlight.min", withExtension: "js", subdirectory: "Resources")
    return url.flatMap { try? String(contentsOf: $0, encoding: .utf8) }
}

/// Fills `syntax` for every file whose language is known. Files the script cannot handle stay one color.
public func highlighted(_ d: WorkspaceDiff, with h: SyntaxHighlighter = .shared) async -> WorkspaceDiff {
    func section(_ s: DiffSection) async -> DiffSection {
        var s = s
        for i in s.files.indices {
            guard let lang = syntaxLanguage(forPath: s.files[i].path) else { continue }
            let at = s.files[i].lines.indices.filter { s.files[i].lines[$0].kind != .hunk }
            guard let spans = await h.spans(at.map { s.files[i].lines[$0].text }, language: lang) else { continue }
            for (j, sp) in zip(at, spans) { s.files[i].lines[j].syntax = sp }
        }
        return s
    }
    var d = d
    if let c = d.committed { d.committed = await section(c) }
    d.uncommitted = await section(d.uncommitted)
    return d
}

/// `nil` entries are scopes github.css paints in the default color; scopes it does not name inherit.
private let scopeKinds: [String: SyntaxKind?] = {
    var m: [String: SyntaxKind?] = ["subst": SyntaxKind?.none]
    let named: [(SyntaxKind, String)] = [
        (.keyword, "doctag keyword template-tag template-variable type"),
        (.entity, "title"),
        (.constant, "attr attribute literal meta number operator variable selector-attr selector-class selector-id"),
        (.string, "regexp string"),
        (.variable, "built_in symbol"),
        (.comment, "comment code formula"),
        (.entityTag, "name quote selector-tag selector-pseudo"),
        (.heading, "section"),
        (.list, "bullet"),
    ]
    for (kind, scopes) in named {
        for s in scopes.split(separator: " ") { m[String(s)] = .some(kind) }
    }
    return m
}()

/// Reads highlight.js output (`<span class="hljs-…">`, five escaped characters) back into spans of `line`.
/// Output that does not spell `line` exactly yields no spans.
func syntaxSpans(html: String, line: String) -> [SyntaxSpan] {
    var pieces: [(text: String, kind: SyntaxKind?)] = []
    var stack: [SyntaxKind?] = []
    var rest = html[...]
    let entities = ["&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#x27;": "'"]
    func add(_ s: String) {
        let kind = stack.last ?? nil
        if let last = pieces.last, last.kind == kind { pieces[pieces.count - 1].text += s } else { pieces.append((s, kind)) }
    }
    while let c = rest.first {
        if rest.hasPrefix("</span>") {
            _ = stack.popLast()
            rest = rest.dropFirst(7)
        } else if rest.hasPrefix("<span class=\""), let end = rest.firstIndex(of: ">") {
            let classes = rest[rest.index(rest.startIndex, offsetBy: 13)..<rest.index(before: end)].split(separator: " ")
            let name = classes.first.map { String($0.dropFirst("hljs-".count)) } ?? ""
            // `variable language_` is `self`/`this`, a keyword in github.css.
            let kind: SyntaxKind?? = classes.contains("language_") ? .some(.keyword) : scopeKinds[name]
            stack.append(kind ?? (stack.last ?? nil))
            rest = rest[rest.index(after: end)...]
        } else if c == "&", let (entity, ch) = entities.first(where: { rest.hasPrefix($0.key) }) {
            add(ch)
            rest = rest.dropFirst(entity.count)
        } else {
            add(String(c))
            rest = rest.dropFirst()
        }
    }
    guard pieces.map(\.text).joined() == line, pieces.reduce(0, { $0 + $1.text.count }) == line.count else { return [] }
    var out: [SyntaxSpan] = []
    var at = 0
    for p in pieces {
        if let kind = p.kind { out.append(SyntaxSpan(range: at..<at + p.text.count, kind: kind)) }
        at += p.text.count
    }
    return out
}
