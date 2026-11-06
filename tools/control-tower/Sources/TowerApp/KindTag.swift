import AppKit
import SwiftUI
import TowerCore

/// What a dropdown line or sidebar label stands for: a my-team team or an agent session.
enum LineKind: Equatable {
    case team
    case agent(AgentKind)

    var text: String {
        switch self {
        case .team: "my-team"
        case .agent(let a): agentName(a).lowercased()
        }
    }

    /// Kept apart from the status colors (orange, red, green, blue) so a tag never reads as a state.
    var color: Color {
        switch self {
        case .team: .purple
        case .agent(.claude): .brown
        case .agent(.codex): .teal
        }
    }

    /// The tag's text: the kind color lifted toward white in dark mode, where the plain color on its own
    /// 0.2 tint reads under 4.5:1.
    var textColor: Color {
        let base = NSColor(color)
        return Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? base.blended(withFraction: 0.35, of: .white) ?? base : base
        })
    }
}

/// The small colored kind label: `my-team`, `claude` or `codex`.
/// `style` nil is the dropdown's fixed size; a style follows the board's font scale.
struct KindTag: View {
    let kind: LineKind
    var style: NSFont.TextStyle?

    var body: some View {
        sized(Text(kind.text))
            .padding(.horizontal, 5).padding(.vertical, 1)
            .background(kind.color.opacity(0.2), in: .capsule)
            .foregroundStyle(kind.textColor)
    }

    @ViewBuilder
    private func sized(_ text: Text) -> some View {
        if let style {
            text.scaledFont(style, weight: .bold, design: .monospaced)
        } else {
            text.font(.caption2.monospaced().bold())
        }
    }
}

/// A live row's leading status icon, shared by the sidebar, the dropdown, the queue and the detail. The full wording is its tooltip
/// and accessibility label. `style` nil is the dropdown's fixed size; a style follows the board's font scale.
struct StatusIconView: View {
    let badge: RowBadge
    var style: NSFont.TextStyle?
    @Environment(\.boardFontScale) private var scale

    var body: some View {
        let size = style.map { NSFont.preferredFont(forTextStyle: $0).pointSize * scale }
            ?? NSFont.preferredFont(forTextStyle: .body).pointSize
        icon(size: size)
            .frame(width: size, height: size)
            .help(badgeLabel(badge))
            .accessibilityElement()
            .accessibilityLabel(badgeLabel(badge))
    }

    @ViewBuilder
    private func icon(size: CGFloat) -> some View {
        switch badge.icon {
        case .spinner:
            ProgressView().controlSize(.small).scaleEffect(size / 16)
        case .waiting:
            Image(systemName: "hand.raised.fill").font(.system(size: size)).foregroundStyle(.orange)
        case .alert:
            Image(systemName: "exclamationmark.circle.fill").font(.system(size: size)).foregroundStyle(.red)
        case .check:
            Image(systemName: "checkmark.circle.fill").font(.system(size: size)).foregroundStyle(.green)
        case .idle:
            Image(systemName: "circle").font(.system(size: size * 0.8)).foregroundStyle(.secondary)
        }
    }
}
