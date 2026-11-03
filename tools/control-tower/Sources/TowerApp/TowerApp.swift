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
                HStack {
                    Text("실행 중").font(.headline)
                    Spacer()
                    if menu.myTurn > 0 {
                        Text("내 차례 \(menu.myTurn)")
                            .font(.caption.bold())
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(Color.orange, in: .capsule)
                            .foregroundStyle(.white)
                    }
                }
                .padding(.bottom, 4)
                if menu.isEmpty {
                    Text("실행 중 세션 없음").foregroundStyle(.secondary).padding(.vertical, 4)
                }
                ForEach(menu.teams, id: \.name) { t in
                    MenuTeamLine(team: t) {
                        tower.boardSelectRequest = t.select
                        openBoard()
                    }
                }
                ForEach(menu.individual, id: \.row.id) { line in
                    MenuCard(tag: line.tag, title: line.title, status: badgeLabel(line.row.badge), message: line.row.line) {
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
private struct KindTag: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption2.monospaced())
            .padding(.horizontal, 5).padding(.vertical, 1)
            .background(.quaternary, in: .capsule)
            .foregroundStyle(.secondary)
    }
}

/// One team in the dropdown: its sidebar header, no worker rows. Clicking it opens the board on that team.
private struct MenuTeamLine: View {
    let team: MenuModel.TeamLine
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    KindTag(text: "my-team")
                    Text(team.name).font(.headline).lineLimit(1)
                }
                Text(team.summary).font(.callout).foregroundStyle(.secondary).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
            .padding(.vertical, 4)
        }
        .accessibilityHint("보드를 열고 이 팀을 선택")
    }
}

/// One individual session in the dropdown. Clicking it focuses that session.
private struct MenuCard: View {
    let tag: String
    let title: String
    let status: String
    let message: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    KindTag(text: tag)
                    Text(title).font(.headline).lineLimit(1)
                    Spacer()
                    Text(status).font(.caption).foregroundStyle(.secondary)
                }
                if !message.isEmpty {
                    Text(message).font(.callout).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
            .padding(.vertical, 4)
        }
        .accessibilityHint("이 세션의 터미널로 이동")
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
