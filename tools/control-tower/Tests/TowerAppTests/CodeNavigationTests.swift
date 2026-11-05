import AppKit
import SwiftUI
import Testing
@testable import TowerCore
@testable import TowerApp

/// TextKit finds the character under a point the way the monospaced line draws it; past the end is nil.
@MainActor @Test func aPointMapsToTheCharacterUnderIt() {
    let font = codeFont(scale: 1)
    let w = ("a" as NSString).size(withAttributes: [.font: font]).width
    let text = "val a.b = List<T>()"
    func at(_ i: Double, line: Double = 0) -> Int? {
        characterIndex(at: CGPoint(x: w * i, y: font.boundingRectForFont.height * line + 2), in: text, font: font, width: 1000)
    }
    #expect(at(0.5) == 0)
    #expect(at(4.5) == 4)
    #expect(at(4.95) == 4)                       // the right edge of a character is still that character
    #expect(at(Double(text.count) - 0.5) == text.count - 1)
    #expect(at(Double(text.count) + 0.5) == nil)  // past the line's end
    #expect(characterIndex(at: .zero, in: "", font: font, width: 100) == nil)
    // wrapped at 10 characters: the second visual line starts at the 11th
    let wrapped = characterIndex(at: CGPoint(x: w * 0.5, y: font.boundingRectForFont.height * 1.5), in: "abcdefghijklmnop", font: font, width: w * 10)
    #expect(wrapped == 10)
    // a character past the BMP and a Hangul syllable count as one Character each
    let wide = "😀가b"
    let bx = ("😀가" as NSString).size(withAttributes: [.font: font]).width
    #expect(characterIndex(at: CGPoint(x: bx + w / 2, y: 2), in: wide, font: font, width: 1000) == 2)
}

@MainActor @Test func onlyACommandClickOnAHoveredLineIsTaken() {
    var opened = 0
    CommandClick.target = nil
    #expect(!CommandClick.handle(.leftMouseDown, clickCount: 1, flags: .command))  // nothing hovered
    let id = UUID()
    CommandClick.hover(.init(id: id, open: { opened += 1 }, refresh: {}))
    #expect(!CommandClick.handle(.leftMouseDown, clickCount: 1, flags: []))          // selection's click
    #expect(!CommandClick.handle(.leftMouseDown, clickCount: 1, flags: [.command, .shift]))
    #expect(!CommandClick.handle(.leftMouseDown, clickCount: 2, flags: .command))
    #expect(opened == 0)
    #expect(CommandClick.handle(.leftMouseDown, clickCount: 1, flags: [.command, .capsLock]))
    #expect(opened == 1)
    CommandClick.leave(UUID())  // another line leaving keeps this one
    #expect(CommandClick.target != nil)
    CommandClick.leave(id)
    #expect(CommandClick.target == nil)
}

@MainActor @Test func historyFollowsTheWorkspaceAndTheTree() {
    let s = ChangesState()
    s.select(workspace: "/w1")
    s.open(CodeLocation(path: "A.kt", line: 3))
    #expect(s.history.current == CodeLocation(path: "A.kt", line: 3))
    s.select(workspace: "/w1")
    #expect(s.history.current != nil)  // the same workspace keeps it
    s.reveal(DiffFileKey(part: .uncommitted, path: "B.kt"))
    #expect(s.history.current == nil && s.history.canGoForward)  // a tree click shows the diff
    s.select(workspace: "/w2")
    #expect(s.history == CodeHistory())
}

/// A navigating line draws exactly as before: the Command-click support adds nothing visible.
@MainActor @Test func aNavigatingLineLooksTheSame() throws {
    var line = DiffLine(kind: .added, old: nil, new: 4, text: "let a = b.c")
    line.changes = [4..<5]
    line.syntax = [SyntaxSpan(range: 0..<3, kind: .keyword)]
    func pixels(_ target: CodeLocation?) throws -> Data {
        let r = ImageRenderer(content: LineView(line: line, target: target).frame(width: 400).environment(\.colorScheme, .dark))
        r.scale = 1
        return try #require(r.nsImage).tiffRepresentation!
    }
    #expect(try pixels(nil) == pixels(CodeLocation(path: "a.swift", line: 4)))
}

/// The premise of `characterIndex`: SwiftUI's `Text` in the diff font puts each character where TextKit does.
@MainActor @Test func swiftUITextDrawsCharactersWhereTextKitPutsThem() throws {
    let font = codeFont(scale: 1.5)
    for text in ["    x", "a.b.c(xyz) x", "List<T> = 가나 x"] {
        let r = ImageRenderer(content: Text(text).font(.system(size: font.pointSize, design: .monospaced))
            .foregroundStyle(.black).padding(.trailing, 20).background(.white))
        r.scale = 1
        let image = try #require(r.nsImage)
        let rep = NSBitmapImageRep(cgImage: try #require(image.cgImage(forProposedRect: nil, context: nil, hints: nil)))
        // the last character's ink: its left edge in pixels
        let xs = (0..<rep.pixelsWide).filter { x in (0..<rep.pixelsHigh).contains { rep.colorAt(x: x, y: $0)!.brightnessComponent < 0.5 } }
        let inkStart = try #require(xs.last { x in !xs.contains(x - 1) })
        let i = text.count - 1
        let hit = characterIndex(at: CGPoint(x: CGFloat(inkStart) + 1, y: 4), in: text, font: font, width: 2000)
        #expect(hit == i, "\(text): ink at \(inkStart)")
    }
}
