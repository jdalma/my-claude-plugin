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
                let mine = sortCards(sessions(board).filter(\.myTurn))
                if mine.isEmpty {
                    Text("기다리는 세션 없음").foregroundStyle(.secondary).padding(.vertical, 4)
                }
                ForEach(mine, id: \.rowID) { s in
                    MenuCard(title: displayTitle(s, in: board), status: menuStatus(s, in: board),
                             message: s.lastAssistant) { tower.focus(s.handle) }
                }
                Divider().padding(.vertical, 4)
            }
            Button("보드 열기") {
                openWindow(id: "board")
                NSApp.activate()
            }
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
}

/// One my_turn row in the dropdown. Clicking it focuses that session.
private struct MenuCard: View {
    let title: String
    let status: String
    let message: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
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
