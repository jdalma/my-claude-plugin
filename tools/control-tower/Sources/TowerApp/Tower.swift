import AppKit
import Observation
import TowerCore

/// The one collection loop. Menu bar and board window read the same `board`.
@MainActor @Observable
final class Tower {
    private(set) var board: Board?
    /// Why the board has no teams, when my-team failed. A GUI app's stderr is invisible.
    private(set) var myTeamError: String?
    /// Past sessions, newest first. Its own loop: the first scan takes 2-3 s and must not delay the board.
    private(set) var history: [HistorySession] = []
    @ObservationIgnored private var notifier: Notifier?

    init() {
        notifier = Notifier { [weak self] in self?.focus($0) }
        // Lives as long as the app.
        Task {
            while true {
                await refresh()
                try? await Task.sleep(for: .seconds(5))
            }
        }
        Task {
            while true {
                guard let board else {
                    try? await Task.sleep(for: .seconds(1))
                    continue
                }
                history = await Task.detached { await collectHistory(board: board) }.value
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }

    private func refresh() async {
        // collect blocks for about a second; keep it off the main actor.
        let snap = await Task.detached { await collectSnapshot() }.value
        let next = snap.board
        myTeamError = snap.myTeamError
        for s in newlyMyTurn(prev: board, next: next) {
            notifier?.post(s, title: displayTitle(s, in: next))
        }
        board = next
    }

    var myTurn: Int { board.map(myTurnCount) ?? 0 }

    /// Moves focus to `handle`. Failures surface as an alert; the app never crashes on them.
    func focus(_ handle: String) {
        guard let board else { return }
        Task {
            do {
                let clients = await Task.detached { listClients() }.value
                let plan = planFocus(handle: handle, board: board, clients: clients)
                guard plan.kind != .none else { throw FocusError.unreachable(handle) }
                try await FocusRunner.run(plan.commands)
            } catch {
                showAlert("Could not focus session", error)
            }
        }
    }

    /// Double click on a history row: focus the running session that reads it, else resume it in a new Ghostty window.
    func open(_ h: HistorySession) {
        if let s = sessions(board ?? Board(at: "", teams: [], loose: [])).first(where: { $0.transcript == h.transcriptPath }) {
            focus(s.handle)
            return
        }
        var ended = h
        ended.live = false
        Task {
            do {
                guard let argv = planResume(ended) else { throw FocusError.noWorkspace(h.workspace) }
                try await FocusRunner.run([argv])
            } catch {
                showAlert("Could not resume session", error)
            }
        }
    }

    private func showAlert(_ title: String, _ error: any Error) {
        NSApp.activate()
        let alert = NSAlert(error: error)
        alert.messageText = title
        alert.informativeText = error.localizedDescription
        alert.runModal()
    }
}

enum FocusError: LocalizedError {
    case unreachable(String)
    case noWorkspace(String)
    var errorDescription: String? {
        switch self {
        case .unreachable(let h): "\(h) is no longer on the board or has no terminal to bring forward."
        case .noWorkspace(let w): "Cannot resume: the session has no workspace (\(w))."
        }
    }
}

/// `team / worker` for a team worker, the card name otherwise.
func displayTitle(_ s: Session, in board: Board) -> String {
    for t in board.teams {
        if let w = t.workers.first(where: { $0.handle == s.handle }) { return "\(t.name) / \(w.cardName)" }
    }
    return s.cardName
}

func sessions(_ b: Board) -> [Session] {
    b.teams.flatMap { $0.workers.map(\.session) } + b.loose
}

extension Session {
    /// A list id unique across teams and loose. A handle alone repeats when two processes
    /// claim one pane; a pid alone repeats as 0 for workers with no recognized process.
    var rowID: String { "\(handle)#\(pid)" }
}
