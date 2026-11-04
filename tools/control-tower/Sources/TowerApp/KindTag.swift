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

    var color: Color {
        switch self {
        case .team: .purple
        case .agent(.claude): .orange
        case .agent(.codex): .teal
        }
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
            .foregroundStyle(kind.color)
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

/// A live row's leading status icon, shared by the sidebar and the dropdown. The full wording is its tooltip
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
        case .waitingDot:
            dot(.orange, size: size)
        case .alert:
            Image(systemName: "exclamationmark.circle.fill").font(.system(size: size)).foregroundStyle(.red)
        case .check:
            Image(systemName: "checkmark.circle.fill").font(.system(size: size)).foregroundStyle(.green)
        case .idleDot:
            dot(.secondary, size: size)
        }
    }

    private func dot(_ color: Color, size: CGFloat) -> some View {
        Circle().fill(color).frame(width: size * 0.5, height: size * 0.5)
    }
}
