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

/// T38b log: SwiftUI writes 131584 back when the board becomes key, after the probe moved in.
@MainActor @Test func aLaterRewriteOfTheBehaviorIsUndone() {
    let w = window()
    w.contentView = FullScreenCapable().makeProbe()
    w.collectionBehavior = [.auxiliary, .fullScreenNone]
    #expect(w.collectionBehavior == [.primary, .fullScreenPrimary])
    w.contentView = NSView()  // once the probe leaves, the window is left alone
    w.collectionBehavior = [.fullScreenNone]
    #expect(w.collectionBehavior == [.fullScreenNone])
}

/// What SwiftUI gives the board in the accessory app (T38b log: 131584 = .auxiliary + .fullScreenNone).
@MainActor @Test func theAuxiliaryMarkSwiftUIGivesTheBoardBecomesPrimary() {
    let roles: NSWindow.CollectionBehavior = [.primary, .auxiliary, .canJoinAllApplications]
    let w = window([.auxiliary, .fullScreenNone])
    w.contentView = FullScreenCapable().makeProbe()
    #expect(w.collectionBehavior.intersection(roles) == .primary)
    #expect(w.collectionBehavior.intersection(fullScreenBits) == .fullScreenPrimary)
}
