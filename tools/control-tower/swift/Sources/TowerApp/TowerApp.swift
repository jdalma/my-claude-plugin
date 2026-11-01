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
    }
}

struct MenuContent: View {
    let tower: Tower
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let board = tower.board {
                let mine = sortCards(sessions(board).filter(\.myTurn))
                if mine.isEmpty {
                    Text("Nobody is waiting for you").foregroundStyle(.secondary).padding(.vertical, 4)
                }
                ForEach(mine, id: \.handle) { s in
                    MenuCard(title: displayTitle(s, in: board), status: statusLine(s, at: board.at).label,
                             message: s.lastAssistant) { tower.focus(s.handle) }
                }
                Divider().padding(.vertical, 4)
            }
            Button("Open Board") {
                openWindow(id: "board")
                NSApp.activate()
            }
            .keyboardShortcut("b")
            Divider().padding(.vertical, 4)
            Button("Quit Control Tower") { NSApp.terminate(nil) }
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
        .accessibilityHint("Focus this session's terminal")
    }
}
