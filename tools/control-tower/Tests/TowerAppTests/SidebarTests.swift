import Foundation
import Testing
import TowerCore
@testable import TowerApp

private let at = "2026-11-02T10:00:00.000Z"
private let ago10 = "2026-11-02T09:50:00.000Z"

private func session(_ handle: String, agent: AgentKind = .claude, cwd: String = "/Users/me/proj", status: Status = .wait,
                     myTurn: Bool = false, since: String? = ago10, permission: Bool = false,
                     transcript: String? = nil, lastUser: String = "", lastAssistant: String = "") -> Session {
    Session(handle: handle, agent: agent, pid: 1, cwd: cwd, startedAt: nil, status: status, myTurn: myTurn, since: since,
            permissionPrompt: permission, title: "", tmux: nil, transcript: transcript,
            lastUser: lastUser, lastAssistant: lastAssistant, termProgram: nil)
}

private func worker(_ name: String, session: Session = session("pane:t:%1"), alive: Bool = true,
                    state: StateFile? = nil, role: String? = "worker") -> Worker {
    Worker(session: session, workerName: name, role: role, description: "", paneId: "%1", alive: alive, spool: 0,
           inbox: 0, sentPending: 0, oldestPendingAt: nil, stateFile: state)
}

private func team(_ name: String, _ workers: [Worker]) -> Team {
    Team(name: name, sessionName: "my-team-\(name)", startedAt: nil, attached: true, workers: workers)
}

private func history(_ title: String, agent: AgentKind = .claude, workspace: String = "/Users/me/proj", branch: String? = "main",
                     path: String = "/t/a.jsonl", live: Bool = false) -> HistorySession {
    HistorySession(id: "id", agent: agent, title: title, workspace: workspace, branch: branch, createdAt: nil,
                   updatedAt: ago10, lastPrompt: nil, transcriptPath: path, live: live, resumeCommand: ["claude", "--resume", "id"])
}

private func model(_ board: Board, history: [HistorySession] = [], query: String = "", filter: AgentFilter = .all) -> SidebarModel {
    sidebarModel(board: board, history: history, query: query, filter: filter, home: "/Users/me")
}

@Test func teamSummaryCountsStoppedAndOmitsZeroSegments() {
    let done = StateFile(state: "done", reason: nil, updatedAt: ago10)
    let board = Board(at: at, teams: [team("t", [
        worker("a", session: session("pane:t:%1", status: .busy)),
        worker("b", session: session("pane:t:%2", myTurn: true)),
        worker("c", session: session("pane:t:%3"), state: done),
        worker("d", session: session("pane:t:%4"), alive: false),
    ])], loose: [])
    let g = model(board).teams[0]
    #expect(g.summary == "워커 4 · 작업 중 1 · 대기 1 · 완료 1 · 멈춤 1 숨김")
    #expect(g.rows.map(\.title) == ["b", "a", "c"])
}

@Test func summaryOmitsEmptySegments() {
    let board = Board(at: at, teams: [team("t", [worker("a", session: session("pane:t:%1", status: .busy))])], loose: [])
    #expect(model(board).teams[0].summary == "워커 1 · 작업 중 1")
}

@Test func permissionPromptOverridesWorkerBadgeAndDeadWorkerIsDropped() {
    let board = Board(at: at, teams: [team("t", [
        worker("a", session: session("pane:t:%1", status: .busy, permission: true)),
        worker("b", session: session("pane:t:%2", permission: true), alive: false),
    ])], loose: [])
    let rows = model(board).teams[0].rows
    #expect(rows.count == 1)
    #expect(rows[0].badge == .permission)
}

@Test func workerBadgesCarryMinutes() {
    let board = Board(at: at, teams: [team("t", [worker("a", session: session("pane:t:%1", myTurn: true))])], loose: [])
    #expect(model(board).teams[0].rows[0].badge == .waitingForUser(minutes: 10))
}

@Test func workerLinePrefersStateReason() {
    let sf = StateFile(state: "working", reason: "writing tests", updatedAt: nil)
    let board = Board(at: at, teams: [team("t", [
        worker("a", session: session("pane:t:%1", lastAssistant: "hello\nworld"), state: sf),
        worker("b", session: session("pane:t:%2", lastAssistant: "hello\nworld")),
    ])], loose: [])
    #expect(model(board).teams[0].rows.map(\.line) == ["writing tests", "hello world"])
}

@Test func looseSessionsGroupByWorkspaceWithTilde() {
    let board = Board(at: at, teams: [], loose: [
        session("pid:1", cwd: "/Users/me/proj", lastUser: "hi"),
        session("pid:2", agent: .codex, cwd: "/Users/me/proj", status: .busy, lastAssistant: "ok"),
        session("pid:3", cwd: "/opt/other", myTurn: true),
    ])
    let ws = model(board).workspaces
    #expect(ws.map(\.path) == ["/opt/other", "~/proj"])
    #expect(ws[1].name == "proj")
    #expect(ws[1].rows.map(\.title).sorted() == ["Claude", "Codex"])
    #expect(ws[1].rows.first { $0.title == "Codex" }?.badge == .working)
    #expect(ws[1].rows.first { $0.title == "Claude" }?.line == "hi")
    #expect(ws[0].rows[0].badge == .waitingForUser(minutes: 10))
}

@Test func searchFiltersLiveRowsAndHistory() {
    let board = Board(at: at, teams: [
        team("alpha", [worker("builder", session: session("pane:a:%1"))]),
        team("beta", [worker("other", session: session("pane:b:%1"))]),
    ], loose: [session("pid:9", cwd: "/Users/me/zebra")])
    let hist = [history("alpha · builder", path: "/t/1"), history("misc", workspace: "/Users/me/zebra", branch: "feat/x", path: "/t/2")]

    let byTeam = model(board, history: hist, query: "ALPHA")
    #expect(byTeam.teams.map(\.name) == ["alpha"])
    #expect(byTeam.workspaces.isEmpty)
    #expect(byTeam.history.map(\.transcriptPath) == ["/t/1"])

    let byCwd = model(board, history: hist, query: "zebra")
    #expect(byCwd.teams.isEmpty)
    #expect(byCwd.workspaces.map(\.name) == ["zebra"])
    #expect(byCwd.history.map(\.transcriptPath) == ["/t/2"])

    #expect(model(board, history: hist, query: "feat/x").history.count == 1)
    #expect(model(board, history: hist, query: "builder").teams[0].rows.map(\.title) == ["builder"])
}

@Test func liveRowBranchComesFromMatchingHistory() {
    let board = Board(at: at, teams: [], loose: [session("pid:1", transcript: "/t/1")])
    let m = model(board, history: [history("x", branch: "feat/live", path: "/t/1", live: true)], query: "feat/live")
    #expect(m.workspaces.count == 1)
    #expect(m.workspaces[0].rows[0].matched?.branch == "feat/live")
}

@Test func agentFilterAndEmptyTitleFallback() {
    let board = Board(at: at, teams: [], loose: [])
    let hist = [history("", workspace: "/Users/me/proj", path: "/t/1"), history("c", agent: .codex, path: "/t/2")]
    #expect(model(board, history: hist, filter: .claude).history.map(\.transcriptPath) == ["/t/1"])
    #expect(model(board, history: hist, filter: .codex).history.map(\.transcriptPath) == ["/t/2"])
    #expect(model(board, history: hist).history.count == 2)
    #expect(historyTitle(hist[0]) == "proj")
    #expect(historyTitle(hist[1]) == "c")
}

@Test func historySubtitleAndResumeText() {
    #expect(historySubtitle(history("t", branch: "main")) == "Claude · proj · main · 종료됨")
    #expect(historySubtitle(history("t", agent: .codex, branch: nil, live: true)) == "Codex · proj · 실행 중")
    #expect(resumeCopyText(history("t", workspace: "/a/it's")) == "cd '/a/it'\\''s' && claude --resume id")
}

@Test func relativeTimeBuckets() {
    let now = Date(timeIntervalSince1970: 1_000_000_000)
    func ago(_ s: Int) -> String {
        relativeTime(isoOf(now.addingTimeInterval(-Double(s))), now: now)
    }
    #expect(ago(30) == "방금")
    #expect(ago(5 * 60) == "5분 전")
    #expect(ago(3 * 3600) == "3시간 전")
    #expect(ago(30 * 3600) == "어제")
    #expect(ago(3 * 86400 + 100) == "3일 전")
    #expect(relativeTime(nil, now: now) == "")
}

private func isoOf(_ d: Date) -> String { d.formatted(.iso8601) }

@Test func badgeLabels() {
    #expect(badgeLabel(.waitingForUser(minutes: 12)) == "사용자 대기 12분")
    #expect(badgeLabel(.waitingForUser(minutes: nil)) == "사용자 대기")
    #expect(badgeLabel(.working) == "작업 중")
    #expect(badgeLabel(.done(minutesAgo: 3)) == "3분 전 완료")
    #expect(badgeLabel(.idle(minutes: 7)) == "대기 7분")
    #expect(badgeLabel(.idle(minutes: nil)) == "대기")
}

@Test func abbreviatesHome() {
    #expect(abbreviate("/Users/me", home: "/Users/me") == "~")
    #expect(abbreviate("/Users/me/a", home: "/Users/me") == "~/a")
    #expect(abbreviate("/Users/mex/a", home: "/Users/me") == "/Users/mex/a")
}

@Test func aDoneWorkerOnAPermissionPromptIsWaitingInBothRowAndSummary() {
    let done = StateFile(state: "done", reason: nil, updatedAt: ago10)
    let board = Board(at: at, teams: [team("t", [
        worker("a", session: session("pane:t:%1", myTurn: true, permission: true), state: done),
        worker("b", session: session("pane:t:%2", myTurn: true), state: done),
    ])], loose: [])
    let g = model(board).teams[0]
    #expect(g.rows.first { $0.title == "a" }?.badge == .permission)
    #expect(g.rows.first { $0.title == "b" }?.badge == .done(minutesAgo: 10))
    #expect(g.summary == "워커 2 · 대기 1 · 완료 1")
}

@Test func theMenuBarSaysWhatTheBoardSays() {
    let done = StateFile(state: "done", reason: nil, updatedAt: ago10)
    let doneW = worker("a", session: session("pane:t:%1", myTurn: true), state: done)
    let permW = worker("b", session: session("pane:t:%2", myTurn: true, permission: true), state: done)
    let deadW = worker("c", session: session("pane:t:%3"), alive: false)
    let loose = session("pid:9", myTurn: true)
    let board = Board(at: at, teams: [team("t", [doneW, permW, deadW])], loose: [loose])
    #expect(menuStatus(doneW.session, in: board) == "10분 전 완료")
    #expect(menuStatus(permW.session, in: board) == "권한 요청")
    #expect(menuStatus(deadW.session, in: board) == "멈춤")
    #expect(menuStatus(loose, in: board) == "사용자 대기 10분")
    let rows = model(board).teams[0].rows
    #expect(menuStatus(doneW.session, in: board) == badgeLabel(rows.first { $0.title == "a" }!.badge))
    #expect(myTurnCount(board) == 3)
}

@Test func durationsRollUpIntoHoursAndDays() {
    let cases = [(0, "0분"), (59, "59분"), (60, "1시간"), (61, "1시간 1분"), (1439, "23시간 59분"),
                 (1440, "1일"), (1500, "1일 1시간"), (2503, "1일 17시간")]
    for (m, text) in cases { #expect(duration(minutes: m) == text) }
    #expect(badgeLabel(.waitingForUser(minutes: 2503)) == "사용자 대기 1일 17시간")
    #expect(badgeLabel(.done(minutesAgo: 61)) == "1시간 1분 전 완료")
    #expect(badgeLabel(.idle(minutes: 60)) == "대기 1시간")
}
