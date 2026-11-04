import AppKit
import SwiftUI

/// GitHub's diff colors, light and dark, from @primer/primitives 11.10.0
/// (dist/css/functional/themes/light.css and dark.css, `--diffBlob-*`).
/// Dark values are translucent, as in Primer; they lay over the diff pane's own background.
enum DiffColors {
    static let addedLine = pair(0xdafbe1ff, 0x2ea04326)
    static let addedNumber = pair(0xaceebbff, 0x3fb9504d)
    static let addedWord = pair(0xaceebbff, 0x2ea04366)
    static let removedLine = pair(0xffebe9ff, 0xf851491a)
    static let removedNumber = pair(0xffcecbff, 0xf851494d)
    static let removedWord = pair(0xffcecbff, 0xf8514966)
    static let hunkLine = pair(0xddf4ffff, 0x388bfd1a)
    /// Text on our lighter-than-GitHub pane: `--fgColor-muted`/`-success`/`-danger` from the
    /// light-high-contrast and dark-high-contrast themes, since the plain ones read under 4.5:1 here.
    static let mutedText = pair(0x454c54ff, 0xb7bdc8ff)
    static let addedCount = pair(0x04591fff, 0x2bd853ff)
    static let removedCount = pair(0x960d1eff, 0xff9492ff)

    /// Resolved against the appearance the view is drawn in, which T26's choice sets.
    private static func pair(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            rgba(appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light)
        })
    }

    static func rgba(_ v: UInt32) -> NSColor {
        func c(_ shift: UInt32) -> CGFloat { CGFloat((v >> shift) & 0xff) / 255 }
        return NSColor(srgbRed: c(24), green: c(16), blue: c(8), alpha: c(0))
    }
}
