import SwiftUI
import Testing
@testable import TowerCore
@testable import TowerApp

/// A split row takes the taller side's height (a wrapped long line), never an unbounded one.
@MainActor @Test func aSplitRowFitsItsTallerSide() throws {
    let short = DiffLine(kind: .removed, old: 1, new: nil, text: "a(1)")
    let long = DiffLine(kind: .added, old: nil, new: 1, text: String(repeating: "word ", count: 80))
    func height(_ row: SplitRow, _ lines: [DiffLine]) throws -> CGFloat {
        let r = ImageRenderer(content: SplitRowView(row: row, lines: lines).frame(width: 600))
        return try #require(r.nsImage).size.height
    }
    let one = try height(.pair(old: 0, new: 1), [short, short])
    let tall = try height(.pair(old: 0, new: 1), [short, long])
    let empty = try height(.pair(old: 0, new: nil), [short])
    #expect(one > 5 && one < 40)
    #expect(tall > one * 3 && tall < 1000)
    #expect(abs(empty - one) < 1)
}
