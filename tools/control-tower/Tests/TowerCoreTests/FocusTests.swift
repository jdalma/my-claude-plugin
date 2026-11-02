import Foundation
import Testing
@testable import TowerCore

private let clients = [TmuxClient(session: "my-team-demo-team-mvtepzfv", pid: 111, tty: "/dev/ttys001")]
private func fixtureBoard() throws -> Board { try JSONDecoder().decode(Board.self, from: fixtureData("board.json")) }

@Test func attachedSessionSelectsWindowAndPaneThenActivatesGhostty() throws {
    #expect(planFocus(handle: "pane:my-team-demo-team-mvtepzfv:%39", board: try fixtureBoard(), clients: clients)
        == FocusPlan(kind: .attached, commands: [
            ["tmux", "select-window", "-t", "my-team-demo-team-mvtepzfv:@5"],
            ["tmux", "select-pane", "-t", "%39"],
            ["open", "-a", "Ghostty"],
        ]))
}

@Test func detachedSessionOpensANewGhosttyWindowAttaching() throws {
    #expect(planFocus(handle: "pane:my-team-detached-team-mvrtwe47:%29", board: try fixtureBoard(), clients: clients, tmuxBin: "tmux")
        == FocusPlan(kind: .detached, commands: [
            ["tmux", "select-window", "-t", "my-team-detached-team-mvrtwe47:@4"],
            ["tmux", "select-pane", "-t", "%29"],
            ["open", "-na", "Ghostty.app", "--args", "-e", "tmux", "attach", "-t", "my-team-detached-team-mvrtwe47"],
        ]))
}

@Test func outsideTmuxOpensByTermProgram() throws {
    var b = try fixtureBoard()
    #expect(planFocus(handle: "pid:54524", board: b, clients: clients) == FocusPlan(kind: .outside, commands: [["open", "-a", "Ghostty"]]))
    b.loose[0].termProgram = "Apple_Terminal"
    #expect(planFocus(handle: "pid:54524", board: b, clients: clients) == FocusPlan(kind: .outside, commands: [["open", "-a", "Terminal"]]))
    b.loose[0].termProgram = nil
    #expect(planFocus(handle: "pid:54524", board: b, clients: clients) == .none)
}

@Test func deadWorkerAndUnknownHandlePlanNothing() throws {
    let b = try fixtureBoard()
    #expect(planFocus(handle: "pane:my-team-demo-team-mvtepzfv:%41", board: b, clients: clients) == .none)
    #expect(planFocus(handle: "pane:nope:%1", board: b, clients: clients) == .none)
    #expect(planFocus(handle: "pid:1", board: b, clients: clients) == .none)
}

/// The read-only invariant: TowerCore never types into, ends, or runs focus on a session,
/// and never goes through a shell. `select-*` may appear only as planFocus argv literals.
@Test func towerCoreNeverTypesIntoOrEndsASession() throws {
    let dir = URL(fileURLWithPath: #filePath).appending(path: "../../../Sources/TowerCore").standardizedFileURL
    let files = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: nil)!
        .compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" }
    #expect(files.count > 5)
    for f in files {
        let src = try String(contentsOf: f, encoding: .utf8)
        for banned in ["send-keys", "send-text", "kill-session", "kill-pane", "kill-server", "kill-window", "/bin/sh", "/bin/bash", "\"-c\""] {
            #expect(!src.contains(banned), "\(f.lastPathComponent) contains \(banned)")
        }
        if f.lastPathComponent != "Focus.swift" { #expect(!src.contains("select-"), "\(f.lastPathComponent)") }
    }
}

@Test func tmuxBinIsAbsoluteWhenTmuxIsOnPath() {
    #expect(towerTmuxBin == "tmux" || towerTmuxBin.hasPrefix("/"))
}
