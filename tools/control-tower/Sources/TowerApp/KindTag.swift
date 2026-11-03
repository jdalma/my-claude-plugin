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
