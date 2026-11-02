import Foundation

/// The argv lists that move focus to a session, run in order by the caller.
/// TowerCore only plans; it never executes these (nor planResume's).
public struct FocusPlan: Equatable, Sendable {
    public enum Kind: String, Sendable {
        /// tmux session with an attached client: select the pane, raise Ghostty.
        case attached
        /// tmux session nobody is attached to: select the pane, open a Ghostty window running `tmux attach`.
        case detached
        /// outside tmux: raise its terminal app.
        case outside
        case none
    }

    public var kind: Kind
    public var commands: [[String]]

    public init(kind: Kind, commands: [[String]]) {
        self.kind = kind
        self.commands = commands
    }

    public static let none = FocusPlan(kind: .none, commands: [])
}

/// A Ghostty window opened via `open` gets launchd's PATH (no /opt/homebrew/bin),
/// so the attach command needs tmux's absolute path.
public let towerTmuxBin = resolveExecutable("tmux") ?? "tmux"

private let terminalApps = [
    "ghostty": "Ghostty",
    "iTerm.app": "iTerm",
    "Apple_Terminal": "Terminal",
    "WezTerm": "WezTerm",
    "vscode": "Visual Studio Code",
    "WarpTerminal": "Warp",
]

public func planFocus(handle: String, board: Board, clients: [TmuxClient],
                      ghosttyApp: String = "Ghostty", tmuxBin: String = towerTmuxBin) -> FocusPlan {
    let all = board.teams.flatMap { $0.workers.map(\.session) } + board.loose
    guard let s = all.first(where: { $0.handle == handle }) else { return .none }

    if handle.hasPrefix("pid:") {
        guard let app = s.termProgram.flatMap({ terminalApps[$0] }) else { return .none }
        return FocusPlan(kind: .outside, commands: [["open", "-a", app]])
    }

    guard let t = s.tmux, !t.window.isEmpty else { return .none }
    let tmux = [
        ["tmux", "select-window", "-t", "\(t.session):\(t.window)"],
        ["tmux", "select-pane", "-t", t.pane],
    ]
    if clients.contains(where: { $0.session == t.session }) {
        return FocusPlan(kind: .attached, commands: tmux + [["open", "-a", ghosttyApp]])
    }
    return FocusPlan(kind: .detached,
                     commands: tmux + [["open", "-na", "\(ghosttyApp).app", "--args", "-e", tmuxBin, "attach", "-t", t.session]])
}

/// `claude` usually lives in `~/.local/bin`, which a GUI app's PATH lacks.
public let resumeBins: [AgentKind: String] = [
    .claude: resolveExecutable("claude", in: searchPath + ["\(homeDir)/.local/bin"]) ?? "claude",
    .codex: resolveExecutable("codex") ?? "codex",
]

/// The argv that opens a new Ghostty window in the session's workspace and resumes it there.
/// nil for a live session (resuming would start a second process on it) or one without a workspace.
public func planResume(_ s: HistorySession, ghosttyApp: String = "Ghostty",
                       bins: [AgentKind: String] = resumeBins) -> [String]? {
    guard !s.live, !s.workspace.isEmpty, let program = s.resumeCommand.first else { return nil }
    return ["open", "-na", "\(ghosttyApp).app", "--args", "--working-directory=\(s.workspace)", "-e",
            bins[s.agent] ?? program] + s.resumeCommand.dropFirst()
}
