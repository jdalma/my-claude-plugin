import SwiftUI
import Testing
@testable import TowerCore
@testable import TowerApp

private func runs(_ a: AttributedString) -> [(text: String, fg: Color?, bg: Color?)] {
    a.runs.map { (String(a[$0.range].characters), $0.foregroundColor, $0.backgroundColor) }
}

@Test func syntaxColorsTheTextAndChangedWordsKeepTheBodyColor() {
    var line = DiffLine(kind: .added, old: nil, new: 1, text: "let x = \"b\"")
    line.syntax = [SyntaxSpan(range: 0..<3, kind: .keyword), SyntaxSpan(range: 8..<11, kind: .string)]
    line.changes = [9..<10]
    let r = runs(lineContent(line, marker: "+"))
    #expect(r.map(\.text).joined() == "+let x = \"b\"")
    #expect(r.first { $0.text == "let" }?.fg == DiffColors.syntax(.keyword))
    #expect(r.first { $0.text == "\"" }?.fg == DiffColors.syntax(.string))
    let changed = r.first { $0.text == "b" }
    #expect(changed?.bg == DiffColors.addedWord)
    #expect(changed?.fg == nil)
}

@Test func tabsStillExpandAndLongLinesStayWhole() {
    var line = DiffLine(kind: .context, old: 1, new: 1, text: "\tlet\ta")
    line.syntax = [SyntaxSpan(range: 1..<4, kind: .keyword)]
    #expect(String(lineContent(line, marker: " ").characters) == "     let    a")
    let long = String(repeating: "x = 1; ", count: 2000)
    var l2 = DiffLine(kind: .removed, old: 1, new: nil, text: long)
    l2.syntax = [SyntaxSpan(range: 4..<5, kind: .constant)]
    #expect(String(lineContent(l2, marker: "−").characters) == "−" + long)
    #expect(String(lineContent(DiffLine(kind: .context, old: 1, new: 1, text: ""), marker: " ").characters) == " ")
}
