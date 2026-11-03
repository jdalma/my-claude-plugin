import SwiftUI
import TowerCore

@main
struct TowerApp: App {
    @State private var tower = Tower()

    var body: some Scene {
        MenuBarExtra {
            MenuContent(tower: tower)
        } label: {
            let n = tower.myTurn
            Image(systemName: "antenna.radiowaves.left.and.right")
            if n > 0 { Text("\(n)") }
        }
        .menuBarExtraStyle(.window)

        Window("Control Tower", id: "board") {
            BoardView(tower: tower)
        }
        .defaultSize(width: 1200, height: 760)

        Settings {
            SettingsView()
        }
    }
}

struct MenuContent: View {
    let tower: Tower
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let error = tower.myTeamError {
                MyTeamErrorLine(error: error).font(.callout).padding(.bottom, 4)
            }
            if let board = tower.board {
                let menu = menuModel(board, home: NSHomeDirectory())
                if menu.isEmpty {
                    Text("열린 터미널 없음").foregroundStyle(.secondary).padding(.vertical, 4)
                }
                ForEach(menu.teams, id: \.name) { t in
                    MenuLine(kind: .team, title: t.name, hint: "보드를 열고 이 팀을 선택") {
                        tower.boardSelectRequest = t.select
                        openBoard()
                    }
                }
                ForEach(menu.individual, id: \.row.id) { line in
                    MenuLine(kind: .agent(line.row.session.agent), title: line.title, hint: "이 세션의 터미널로 이동") {
                        tower.focus(line.row.session.handle)
                    }
                    .help(line.path)
                }
                Divider().padding(.vertical, 4)
            }
            Button("보드 열기", action: openBoard)
                .keyboardShortcut("b")
            SettingsLink { Text("설정…") }
                .keyboardShortcut(",")
            Divider().padding(.vertical, 4)
            Button("Control Tower 종료") { NSApp.terminate(nil) }
                .keyboardShortcut("q")
        }
        .buttonStyle(.borderless)
        .padding(10)
        .frame(width: 320, alignment: .leading)
    }

    private func openBoard() {
        openWindow(id: "board")
        NSApp.activate()
    }
}

/// The small kind label at the front of a dropdown line: `my-team`, `claude` or `codex`.
private enum LineKind {
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

private struct KindTag: View {
    let kind: LineKind

    var body: some View {
        Text(kind.text)
            .font(.caption2.monospaced().bold())
            .padding(.horizontal, 5).padding(.vertical, 1)
            .background(kind.color.opacity(0.2), in: .capsule)
            .foregroundStyle(kind.color)
    }
}

/// One dropdown line: kind label and name. A team opens the board on it; a session focuses its terminal.
private struct MenuLine: View {
    let kind: LineKind
    let title: String
    let hint: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                KindTag(kind: kind)
                Text(title).font(.headline).foregroundStyle(.primary).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
            .padding(.vertical, 4)
        }
        .accessibilityHint(hint)
    }
}

/// One line saying teams are missing because my-team failed; the full text is in the tooltip.
/// The caller sets the font: fixed in the dropdown, scaled in the board window.
struct MyTeamErrorLine: View {
    let error: String

    var body: some View {
        Label("팀 정보를 읽지 못함: \(error)", systemImage: "exclamationmark.triangle.fill")
            .foregroundStyle(.orange)
            .lineLimit(1)
            .truncationMode(.tail)
            .help(error)
    }
}
