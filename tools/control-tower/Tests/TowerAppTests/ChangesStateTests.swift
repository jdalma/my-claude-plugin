import Testing
@testable import TowerApp

private let a = DiffFileKey(part: .uncommitted, path: "src/a.swift")
private let b = DiffFileKey(part: .committed, path: "src/b.swift")

@MainActor @Test func filesStartFoldedAndANewFileStaysFolded() {
    let s = ChangesState()
    s.select(workspace: "/w")
    #expect(!s.isExpanded(a))
    s.toggle(a)
    #expect(s.isExpanded(a))
    // a file that shows up on a later refresh has no entry, so it is folded
    #expect(!s.isExpanded(b))
    s.toggle(a)
    #expect(!s.isExpanded(a))
}

@MainActor @Test func revealUnfoldsTheFileAndItsSectionAndAsksForAScroll() {
    let s = ChangesState()
    s.showCommitted = false
    s.reveal(b)
    #expect(s.isExpanded(b))
    #expect(s.showCommitted)
    #expect(s.scrollTarget == b)
}

@MainActor @Test func foldingAllAndUnfoldingAllTouchOnlyTheGivenKeys() {
    let s = ChangesState()
    s.toggle(b)
    s.setExpanded([a], true)
    #expect(s.isExpanded(a) && s.isExpanded(b))
    s.setExpanded([a], false)
    #expect(!s.isExpanded(a) && s.isExpanded(b))
}

@MainActor @Test func switchingWorkspaceFoldsEverythingAgain() {
    let s = ChangesState()
    s.select(workspace: "/w1")
    s.toggle(a)
    s.select(workspace: "/w1")
    #expect(s.isExpanded(a))
    s.select(workspace: "/w2")
    #expect(!s.isExpanded(a))
}

@Test func treeWidthStaysWithinBounds() {
    #expect(clampTreeWidth(100) == 160)
    #expect(clampTreeWidth(300) == 300)
    #expect(clampTreeWidth(900) == 480)
}
