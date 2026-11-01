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

