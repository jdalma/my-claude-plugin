import AppKit
import SwiftUI
import Testing
@testable import TowerApp

@Test func storedChoiceMapsToAnAppearance() {
    #expect(AppearanceChoice(stored: "system").appearanceName == nil)
    #expect(AppearanceChoice(stored: "light").appearanceName == .aqua)
    #expect(AppearanceChoice(stored: "dark").appearanceName == .darkAqua)
    #expect(AppearanceChoice(stored: "sepia") == .system)
    #expect(AppearanceChoice.allCases.map(\.label) == ["시스템", "라이트", "다크"])
}

/// The tag color resolves against the appearance it is drawn in (which NSApp.appearance sets),
/// not the system setting.
@Test func tagTextLightensOnlyWhenDrawnDark() {
    func resolved(_ name: NSAppearance.Name) -> (text: NSColor, base: NSColor) {
        var c = (text: NSColor.clear, base: NSColor.clear)
        NSAppearance(named: name)!.performAsCurrentDrawingAppearance {
            c = (NSColor(LineKind.team.textColor).usingColorSpace(.sRGB)!, NSColor(LineKind.team.color).usingColorSpace(.sRGB)!)
        }
        return c
    }
    let light = resolved(.aqua), dark = resolved(.darkAqua)
    #expect(light.text == light.base)
    #expect(dark.text != dark.base)
    #expect(dark.text.brightnessComponent > dark.base.brightnessComponent)
}
