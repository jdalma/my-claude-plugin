import Foundation
import TowerCore

// The sidebar's data, projected from a board and the history list. No view code, so the
// grouping, wording and search are testable.

enum RowID: Hashable {
    /// `Session.rowID`.
    case live(String)
    /// `HistorySession.transcriptPath`.
    case history(String)
}

enum RowBadge: Equatable {
    case waitingForUser(minutes: Int?)
    case permission
    case working
    case done(minutesAgo: Int?)
    case idle(minutes: Int?)
}

struct LiveRow: Equatable {
    var id: RowID
    var session: Session
    var worker: Worker?
    var teamName: String?
    var title: String
    var line: String
    var badge: RowBadge
    /// The history entry that reads this session's transcript: source of its branch and resume command.
    var matched: HistorySession?
}

struct TeamGroup: Equatable {
    var name: String
    var summary: String
    var rows: [LiveRow]
}

struct WorkspaceGroup: Equatable {
    var name: String
    /// `~`-abbreviated.
    var path: String
    var rows: [LiveRow]
}

struct SidebarModel: Equatable {
    var myTurn: Int
    var teams: [TeamGroup]
    var workspaces: [WorkspaceGroup]
    /// One page or more of the filtered history, running sessions listed above left out.
    var history: [HistorySession]
    /// Filtered history entries past `history`.
    var historyRemaining: Int

    var liveRows: [LiveRow] { teams.flatMap(\.rows) + workspaces.flatMap(\.rows) }
}

enum AgentFilter: Hashable {
    case all, claude, codex
}

let historyPageSize = 30

func sidebarModel(board: Board, history: [HistorySession], query: String, filter: AgentFilter, historyLimit: Int,
                  home: String) -> SidebarModel {
    let byTranscript = Dictionary(history.map { ($0.transcriptPath, $0) }, uniquingKeysWith: { a, _ in a })
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    func hit(_ fields: [String?]) -> Bool {
        q.isEmpty || fields.contains { $0?.lowercased().contains(q) == true }
    }
    func matches(_ r: LiveRow) -> Bool {
        hit([r.teamName, r.worker?.workerName, r.session.cwd, r.title, r.matched?.branch, r.matched?.title])
    }

    // Before search: a row hidden by the query is still listed above, so its session stays out of history.
    var listed = Set(board.loose.compactMap(\.transcript))
    var teams: [TeamGroup] = []
    for team in sortTeams(board.teams) {
        let rows = sortCards(team.workers).compactMap { w -> LiveRow? in
            guard let badge = badge(displayState(w), at: board.at) else { return nil }
            let reason = w.stateFile?.reason ?? ""
            return LiveRow(id: .live(w.session.rowID), session: w.session, worker: w, teamName: team.name,
                           title: w.cardName, line: oneLine(reason.isEmpty ? w.lastAssistant : reason),
                           badge: badge, matched: w.transcript.flatMap { byTranscript[$0] })
        }
        listed.formUnion(rows.compactMap(\.session.transcript))
        let teamHit = hit([team.name])
        let shown = rows.filter { teamHit || matches($0) }
        if q.isEmpty || !shown.isEmpty {
            teams.append(TeamGroup(name: team.name, summary: teamSummaryLine(team), rows: shown))
        }
    }

    var workspaces: [WorkspaceGroup] = []
    for s in sortCards(board.loose) {
        let row = LiveRow(id: .live(s.rowID), session: s, worker: nil, teamName: nil,
                          title: agentName(s.agent),
                          line: oneLine(s.lastAssistant.isEmpty ? s.lastUser : s.lastAssistant),
                          badge: badge(displayState(s), at: board.at) ?? .idle(minutes: nil), matched: s.transcript.flatMap { byTranscript[$0] })
        guard matches(row) else { continue }
        let path = abbreviate(s.cwd, home: home)
        if let i = workspaces.firstIndex(where: { $0.path == path }) {
            workspaces[i].rows.append(row)
        } else {
            workspaces.append(WorkspaceGroup(name: basename(s.cwd), path: path, rows: [row]))
        }
    }

    let past = history.filter { h in
        !listed.contains(h.transcriptPath)
            && (filter == .all || (filter == .claude) == (h.agent == .claude))
            && hit([h.title, h.workspace, h.branch])
    }
    return SidebarModel(myTurn: myTurnCount(board), teams: teams, workspaces: workspaces,
                        history: Array(past.prefix(historyLimit)), historyRemaining: max(0, past.count - historyLimit))
}

/// Maps Core's display state to a row badge; nil for a stopped worker (counted in the team summary, not listed).
private func badge(_ state: WorkerDisplayState, at: String) -> RowBadge? {
    switch state {
    case .stopped: nil
    case .permission: .permission
    case .done(let since): .done(minutesAgo: minutes(from: since, to: at))
    case .waitingForUser(let since): .waitingForUser(minutes: minutes(from: since, to: at))
    case .working: .working
    case .idle(let since): .idle(minutes: minutes(from: since, to: at))
    }
}

/// The menu bar dropdown: the sidebar's running part with each team folded to its header line.
struct MenuModel: Equatable {
    struct TeamLine: Equatable {
        var name: String
        var summary: String
        /// The row the board selects for this line: a worker waiting on me, else the first; nil when none is listed.
        var select: RowID?
    }

    /// A session outside teams, its workspace group folded into the line.
    struct IndividualLine: Equatable {
        /// The sidebar group's name: the workspace folder.
        var title: String
        /// `~`-abbreviated workspace.
        var path: String
        var row: LiveRow
    }

    var myTurn: Int
    var teams: [TeamLine]
    /// The sidebar's individual rows, flattened in its order.
    var individual: [IndividualLine]

    var isEmpty: Bool { teams.isEmpty && individual.isEmpty }
}

func menuModel(_ board: Board, home: String) -> MenuModel {
    let side = sidebarModel(board: board, history: [], query: "", filter: .all, historyLimit: 0, home: home)
    return MenuModel(
        myTurn: side.myTurn,
        teams: side.teams.map { t in
            MenuModel.TeamLine(name: t.name, summary: t.summary, select: (t.rows.first { $0.session.myTurn } ?? t.rows.first)?.id)
        },
        individual: side.workspaces.flatMap { ws in
            ws.rows.map { MenuModel.IndividualLine(title: ws.name, path: ws.path, row: $0) }
        })
}

func teamSummaryLine(_ team: Team) -> String {
    let (total, by) = stateCounts(team)
    let waiting = by[.waitingForUser, default: 0] + by[.idle, default: 0]
    var parts = ["워커 \(total)"]
    if let n = by[.working], n > 0 { parts.append("작업 중 \(n)") }
    if waiting > 0 { parts.append("대기 \(waiting)") }
    if let n = by[.done], n > 0 { parts.append("완료 \(n)") }
    if let n = by[.stopped], n > 0 { parts.append("멈춤 \(n) 숨김") }
    return parts.joined(separator: " · ")
}

func badgeLabel(_ b: RowBadge) -> String {
    switch b {
    case .waitingForUser(let m): m.map { "사용자 대기 \(duration(minutes: $0))" } ?? "사용자 대기"
    case .permission: "권한 요청"
    case .working: "작업 중"
    case .done(let m): m.map { "\(duration(minutes: $0)) 전 완료" } ?? "완료"
    case .idle(let m): m.map { "대기 \(duration(minutes: $0))" } ?? "대기"
    }
}

/// `N분` under an hour, `N시간 M분` under a day, then `N일 M시간`; a zero second part is left out.
func duration(minutes m: Int) -> String {
    func join(_ big: Int, _ bigUnit: String, _ small: Int, _ smallUnit: String) -> String {
        small == 0 ? "\(big)\(bigUnit)" : "\(big)\(bigUnit) \(small)\(smallUnit)"
    }
    if m < 60 { return "\(m)분" }
    if m < 1440 { return join(m / 60, "시간", m % 60, "분") }
    return join(m / 1440, "일", (m % 1440) / 60, "시간")
}

/// `방금` under a minute, then `N분 전`, `N시간 전`, `어제`, `N일 전`; '' when the time is unknown.
func relativeTime(_ iso: String?, now: Date) -> String {
    guard let t = date(iso) else { return "" }
    let s = Int(now.timeIntervalSince(t))
    if s < 60 { return "방금" }
    if s < 3600 { return "\(s / 60)분 전" }
    if s < 86400 { return "\(s / 3600)시간 전" }
    let d = s / 86400
    return d == 1 ? "어제" : "\(d)일 전"
}

/// Local `yyyy-MM-dd HH:mm`, for tooltips.
func fullTime(_ iso: String?) -> String {
    guard let t = date(iso) else { return "" }
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd HH:mm"
    return f.string(from: t)
}

func historyTitle(_ h: HistorySession) -> String {
    h.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? basename(h.workspace) : h.title
}

func agentName(_ a: AgentKind) -> String { a == .claude ? "Claude" : "Codex" }

/// `에이전트 · workspace · branch · 실행 중|종료됨`.
func historySubtitle(_ h: HistorySession) -> String {
    [agentName(h.agent), basename(h.workspace), h.branch.flatMap { $0.isEmpty ? nil : $0 }, h.live ? "실행 중" : "종료됨"]
        .compactMap { $0 }.joined(separator: " · ")
}

func historyTooltip(_ h: HistorySession, home: String) -> String {
    [fullTime(h.updatedAt), abbreviate(h.workspace, home: home)].filter { !$0.isEmpty }.joined(separator: "\n")
}

/// The line the context menu copies: back to the workspace, then the resume command.
func resumeCopyText(_ h: HistorySession) -> String {
    let dir = "'" + h.workspace.replacingOccurrences(of: "'", with: "'\\''") + "'"
    return "cd \(dir) && \(h.resumeCommand.joined(separator: " "))"
}

func abbreviate(_ path: String, home: String) -> String {
    if path == home { return "~" }
    return !home.isEmpty && path.hasPrefix(home + "/") ? "~" + path.dropFirst(home.count) : path
}

private func oneLine(_ s: String) -> String {
    s.split(whereSeparator: \.isNewline).joined(separator: " ").trimmingCharacters(in: .whitespaces)
}

private func date(_ iso: String?) -> Date? {
    parseISO(iso).map { Date(timeIntervalSince1970: $0 / 1000) }
}

private func minutes(from: String?, to: String) -> Int? {
    guard let a = parseISO(from), let b = parseISO(to) else { return nil }
    return max(0, Int(((b - a) / 60000).rounded(.down)))
}
