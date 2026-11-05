import AppKit
import Testing
@testable import TowerApp

/// Windows here are never shown: only their collection behavior is read.
@MainActor private func window(_ behavior: NSWindow.CollectionBehavior = []) -> NSWindow {
    let w = NSWindow(contentRect: .init(x: 0, y: 0, width: 400, height: 300), styleMask: [.titled, .resizable], backing: .buffered, defer: true)
    w.collectionBehavior = behavior
    return w
}

private let fullScreenBits: NSWindow.CollectionBehavior = [.fullScreenPrimary, .fullScreenAuxiliary, .fullScreenNone]

@MainActor @Test func theBoardWindowCanTakeItsOwnFullScreenSpace() {
    let w = window()
    #expect(!w.collectionBehavior.contains(.fullScreenPrimary))
    w.contentView = FullScreenCapable().makeProbe()
    #expect(w.collectionBehavior.contains(.fullScreenPrimary))
    #expect(FullScreenCapable.board === w)  // ⌃⌘F turns this window, whichever window is key
    #expect(!w.isVisible)
}

@MainActor @Test func anOpposingFullScreenBitGivesWayToPrimary() {
    for start: NSWindow.CollectionBehavior in [.fullScreenNone, .fullScreenAuxiliary] {
        let w = window([start, .managed])
        w.contentView = FullScreenCapable().makeProbe()
        #expect(w.collectionBehavior.intersection(fullScreenBits) == .fullScreenPrimary)
        #expect(w.collectionBehavior.contains(.managed))  // other bits stay
    }
}

@MainActor @Test func anUpdateRestoresPrimaryAfterItIsCleared() {
    let w = window()
    let probe = FullScreenCapable().makeProbe()
    w.contentView = probe
    w.collectionBehavior = [.fullScreenNone]
    FullScreenCapable().update(probe)
    #expect(w.collectionBehavior.intersection(fullScreenBits) == .fullScreenPrimary)
}
