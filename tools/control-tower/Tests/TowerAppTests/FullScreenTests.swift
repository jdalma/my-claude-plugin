import AppKit
import Testing
@testable import TowerApp

/// The window is never shown: only its collection behavior is read.
@MainActor @Test func theBoardWindowCanTakeItsOwnFullScreenSpace() {
    let window = NSWindow(contentRect: .init(x: 0, y: 0, width: 400, height: 300), styleMask: [.titled, .resizable], backing: .buffered, defer: true)
    #expect(!window.collectionBehavior.contains(.fullScreenPrimary))
    window.contentView = FullScreenCapable().makeProbe()
    #expect(window.collectionBehavior.contains(.fullScreenPrimary))
    #expect(!window.isVisible)
}
