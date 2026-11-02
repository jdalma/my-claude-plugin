import Foundation
import Testing
@testable import TowerCore

private func fixtureBoard() throws -> Board { try JSONDecoder().decode(Board.self, from: fixtureData("board.json")) }

@Test func myTurnCardsComeFirstWithinATeamDeadLast() throws {
    // %38 my_turn, then %40 (since 05:50) before %39 (05:58), dead %41 last
    #expect(sortCards(try fixtureBoard().teams[0].workers).map(\.paneId) == ["%38", "%40", "%39", "%41"])
}

@Test func deadWorkerGetsTheDeadStatus() throws {
    let b = try fixtureBoard()
    let dead = b.teams[0].workers.first { $0.paneId == "%41" }!
    #expect(statusLine(dead, at: b.at) == (kind: .dead, label: "Dead"))
}

@Test func teamSummaryComesFromTheOrchestrator() throws {
    let s = try #require(teamSummary(try fixtureBoard().teams[0]))
    #expect(s.reason == "tasks A–J closed. 17 user questions pending")
    #expect(s.voice?.workerName == "leader")
    #expect(s.voice?.lastAssistant.contains("Summary written to research/2026-10-31-leader.md") == true)
}

@Test func teamsWithMyTurnWorkersAreListedFirst() throws {
    var b = try fixtureBoard()
    for i in b.teams[0].workers.indices { b.teams[0].workers[i].myTurn = false }
    #expect(sortTeams(b.teams).map(\.name).firstIndex(of: "detached-team")! < sortTeams(b.teams).map(\.name).firstIndex(of: "demo-team")!)
}

@Test func mailLineOnlyWhenACounterIsNonZero() throws {
    let b = try fixtureBoard()
    #expect(mailSummary(b.teams[0].workers, at: b.at).contains("awaiting reply 2 (50m)"))
    #expect(mailSummary(b.teams[1].workers, at: b.at) == "")
}

@Test func statusLineAndMyTurnTotal() throws {
    let b = try fixtureBoard()
    let labels = (b.teams.flatMap { $0.workers.map { statusLine($0, at: b.at) } } + b.loose.map { statusLine($0, at: b.at) })
    #expect(labels.contains { $0.label == "My turn · 20m" })
    #expect(labels.contains { $0.label == "Working · 1m" })
    #expect(labels.contains { $0.kind == .perm })
    #expect(b.teams.flatMap(\.workers).contains { elapsed(from: $0.since, to: b.at) == "20m" })
    #expect(myTurnCount(b) == 3)
    #expect(elapsed(from: "2026-10-29T12:16:44Z", to: "2026-10-31T06:00:00Z") == "41h 43m")
    #expect(elapsed(from: "2026-10-28T08:04:29Z", to: "2026-10-31T06:00:00Z") == "2d 21h")
    #expect(elapsed(from: nil, to: b.at) == "")
}

@Test func summaryFallsBackToTheMostRecentlyActiveWorker() throws {
    var b = try fixtureBoard()
    b.teams[0].workers[0].lastAssistant = ""
    let s = try #require(teamSummary(b.teams[0]))
    // backend-a (since 05:58) is more recent than frontend-b (05:50)
    #expect(s.voice?.workerName == "backend-a")
    #expect(s.voice?.lastAssistant.hasPrefix("Reading docs/adr/*.md") == true)
}

@Test func summaryIsEmptyWhenNobodyHasReported() throws {
    var t = try fixtureBoard().teams[1]
    for i in t.workers.indices {
        t.workers[i].lastAssistant = ""
        t.workers[i].stateFile = nil
    }
    #expect(teamSummary(t) == TeamSummary(reason: nil, voice: nil))
    #expect(teamSummary(Team(name: "x", sessionName: "x", startedAt: nil, attached: false, workers: [])) == nil)
}

@Test func looseSessionsGetClaudeCodeThenCodexColumnsWithTheirOwnCards() throws {
    let b = try fixtureBoard()
    let cols = looseColumns(b)
    #expect(cols.map(\.agent) == [.claude, .codex])
    let codex = try #require(cols.last?.sessions.first { $0.handle == "pid:51170" })
    #expect(statusLine(codex, at: b.at).kind == .mine)
    #expect(statusLine(codex, at: b.at).label.hasPrefix("My turn · "))
    #expect(codex.subtitle == "career brief context handover")
    #expect(codex.lastAssistant.contains("Context received. Nothing further unless you want edits."))
}

@Test func aCodexColumnIsOmittedWhenThereIsNoCodexSession() throws {
    var b = try fixtureBoard()
    b.loose.removeAll { $0.agent == .codex }
    #expect(looseColumns(b).map(\.agent) == [.claude])
}

@Test func cardNamesFollowTheBoardLabels() throws {
    let b = try fixtureBoard()
    #expect(b.teams[0].workers[0].cardName == "leader")
    var w = b.teams[0].workers[0]
    w.workerName = ""
    #expect(w.cardName == "brief fact-check aggregation")
    #expect(b.loose.first { $0.handle == "pid:51170" }?.cardName == basename(b.loose.first { $0.handle == "pid:51170" }!.cwd))
    #expect(cleanTitle("⠋ scanning ADR records") == "scanning ADR records")
}
