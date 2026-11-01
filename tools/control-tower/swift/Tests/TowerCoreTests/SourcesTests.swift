import Foundation
import Testing
@testable import TowerCore

// MARK: - ps (test/sources/ps.test.js)

private func psRows() throws -> [PsRow] { parsePs(try fixture("ps-codex.txt")) }

private func localISO(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int, _ s: Int) -> String {
    isoString(Calendar.current.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi, second: s))!)
}

@Test func parsePsSplitsFixedWidthCommFromArgsAndConvertsLstart() throws {
    let rows = try psRows()
    #expect(rows.count == 10)
    let child = try #require(rows.first { $0.pid == 1001 })
    #expect(child.ppid == 1000)
    #expect(child.tty == "ttys001")
    #expect(child.comm == "/opt/homebrew/li")
    #expect(child.args == "/opt/homebrew/lib/node_modules/@openai/codex/vendor/bin/codex --dangerously-bypass-approvals-and-sandbox")
    #expect(child.lstart == localISO(2026, 10, 29, 21, 15, 20))
    // space-padded day of month
    #expect(rows.first { $0.pid == 2000 }?.lstart == localISO(2026, 10, 2, 8, 0, 0))
    #expect(rows.first { $0.pid == 900 }?.comm == "-zsh")
}

@Test func parsePsSkipsGarbageLines() {
    #expect(parsePs("\nnot a ps line\n").isEmpty)
}

@Test func ancestorsWalksNearestFirstAndStopsBeforeLaunchd() throws {
    let rows = try psRows()
    #expect(ancestors(of: 1002, in: rows) == [1001, 1000, 900])
    #expect(ancestors(of: 1, in: rows) == [])
    #expect(ancestors(of: 99999, in: rows) == [])
    #expect(isDescendant(1002, of: 1000, in: rows))
    #expect(!isDescendant(1000, of: 1002, in: rows))
}

@Test func ancestorsStopsOnACycleAfter40Hops() {
    #expect(ancestors(of: 10, in: [PsRow(pid: 10, ppid: 11), PsRow(pid: 11, ppid: 10)]).count == 40)
}

@Test func parseEnvTakesValuesUpToTheNextNameAndOnlyRequestedKeys() {
    let out = "/bin/codex --x FOO=args-not-env TERM_PROGRAM=ghostty FOO=a b c HOME=/Users/me PATH=/bin:/usr/bin\n"
    #expect(parseEnv(out, keys: ["TERM_PROGRAM", "FOO", "PATH", "MISSING"])
        == ["TERM_PROGRAM": "ghostty", "FOO": "a b c", "PATH": "/bin:/usr/bin"])
}

// MARK: - tmux (test/sources/tmux.test.js)

@Test func paneFormatHasThe8FieldsAndNoPaneCurrentCommand() {
    #expect(paneFormat.split(separator: "\t").count == 8)
    #expect(!paneFormat.contains("pane_current_command"))
}

@Test func parsePanesParsesHostAndWorkerPanes() {
    let text = [
        "my-team-demo-mvtepzfv\t@5\t%40\t4101\t0\t\t✳ 워커 온보딩\t/Users/me/demo",
        "my-team-demo-mvtepzfv\t@5\t%42\t4102\t0\tapi-dev\t⠂ build the api\t/Users/me/demo/api",
        "scratch\t@9\t%77\t4200\t1\t\tzsh\t/tmp",
        "",
    ].joined(separator: "\n")
    #expect(parsePanes(text) == [
        Pane(session: "my-team-demo-mvtepzfv", window: "@5", pane: "%40", pid: 4101, dead: false, workerName: nil, title: "✳ 워커 온보딩", cwd: "/Users/me/demo"),
        Pane(session: "my-team-demo-mvtepzfv", window: "@5", pane: "%42", pid: 4102, dead: false, workerName: "api-dev", title: "⠂ build the api", cwd: "/Users/me/demo/api"),
        Pane(session: "scratch", window: "@9", pane: "%77", pid: 4200, dead: true, workerName: nil, title: "zsh", cwd: "/tmp"),
    ])
}

@Test func parsePanesKeepsATabInsideTheTitle() {
    let p = parsePanes("s\t@1\t%1\t1\t0\tw\ta\tb\t/x\n")[0]
    #expect(p.title == "a\tb")
    #expect(p.cwd == "/x")
}

@Test func parsePanesAndParseClientsOnEmptyOutput() {
    #expect(parsePanes("").isEmpty)
    #expect(parseClients("").isEmpty)
}

@Test func parseClientsParsesSessionPidTty() {
    #expect(parseClients("my-team-demo-mvtepzfv\t5123\t/dev/ttys004\nscratch\t5200\t/dev/ttys007\n") == [
        TmuxClient(session: "my-team-demo-mvtepzfv", pid: 5123, tty: "/dev/ttys004"),
        TmuxClient(session: "scratch", pid: 5200, tty: "/dev/ttys007"),
    ])
}

// MARK: - codex (test/sources/codex.test.js)

@Test func pickCandidatesKeepsTheNativeTUIChildOnly() throws {
    let rows = try psRows()
    #expect(pickCandidates(rows, selfPid: 4000).map(\.pid) == [1001, 5000])
    // without the self filter the helper under 4000 is a TUI too
    #expect(pickCandidates(rows, selfPid: 1).map(\.pid) == [1001, 4001, 5000])
}

@Test func parseLsofGroupsCwdAndFileNamesByPid() {
    let text = [
        "p1001", "fcwd", "n/Users/me/proj", "ftxt", "n/bin/codex",
        "f25", "n/Users/me/.codex/sessions/2026/10/29/rollout-2026-10-29T21-15-26-aaaa.jsonl",
        "p2000", "fcwd", "n/", "f30", "n/Users/me/.codex/sessions/2026/10/30/rollout-b.jsonl", "",
    ].joined(separator: "\n")
    let m = parseLsof(text)
    #expect(m[1001] == OpenFiles(cwd: "/Users/me/proj", paths: [
        "/bin/codex", "/Users/me/.codex/sessions/2026/10/29/rollout-2026-10-29T21-15-26-aaaa.jsonl",
    ]))
    #expect(m[2000]?.paths == ["/Users/me/.codex/sessions/2026/10/30/rollout-b.jsonl"])
    #expect(parseLsof("").isEmpty)
}

@Test func classifyRolloutCompleteAfterStartedIsWait() throws {
    let r = classifyRollout(try fixture("codex-rollout-tail.jsonl"))
    #expect(r.status == .wait)
    #expect(r.since == "2026-10-29T12:17:05.500Z")
}

@Test func classifyRolloutStartedAfterCompleteIsBusy() {
    let r = classifyRollout([
        #"{"timestamp":"2026-10-29T12:00:00.000Z","type":"event_msg","payload":{"type":"task_complete"}}"#,
        #"{"timestamp":"2026-10-29T12:05:00.000Z","type":"event_msg","payload":{"type":"task_started"}}"#,
    ].joined(separator: "\n"))
    #expect(r.status == .busy)
    #expect(r.since == "2026-10-29T12:05:00.000Z")
}

@Test func classifyRolloutNeitherMarkerIsUnknownAndACutOffLineGivesNoSince() {
    let none = classifyRollout(#"{"timestamp":"x","type":"response_item"}"# + "\n")
    #expect(none.status == .unknown && none.since == nil)
    // tail cut mid-line before the timestamp: since is nil, status still decided
    let cut = classifyRollout(#"load":{"type":"task_started"}}"#)
    #expect(cut.status == .busy && cut.since == nil)
}

@Test func classifyRolloutTreatsAnAbortedTurnAsFinished() {
    let r = classifyRollout([
        #"{"timestamp":"T1","type":"event_msg","payload":{"type":"task_started"}}"#,
        #"{"timestamp":"T2","type":"event_msg","payload":{"type":"turn_aborted"}}"#,
    ].joined(separator: "\n"))
    #expect(r.status == .wait && r.since == "T2")
}

// MARK: - my-team (test/sources/myteam.test.js)

private let clients = [TmuxClient(session: "my-team-demo-team-mvtepzfv", pid: 1, tty: "/dev/ttys001")]
private func ok(_ stdout: String) -> CommandResult { CommandResult(status: 0, stdout: stdout, stderr: "") }
private func rawTeams() throws -> [RawTeam] {
    let raw = try fixture("myteam-status.json")
    return try loadTeams(exec: { _, _ in ok(raw) })
}

@Test func myTeamBinPointsAtTheSiblingMyTeamPackage() {
    #expect(myTeamBin.hasSuffix("tools/my-team/bin/my-team"))
    #expect(FileManager.default.fileExists(atPath: myTeamBin))
}

@Test func loadTeamsRunsStatusAllJsonAndKeepsOnlyLiveTeams() throws {
    let raw = try fixture("myteam-status.json")
    var call: [String] = []
    let teams = try loadTeams(bin: "/x/my-team", exec: { bin, args in
        call = [bin] + args
        return ok(raw)
    })
    #expect(call == ["/x/my-team", "status", "--all", "--json"])
    #expect(teams.map(\.teamName) == ["demo-team", "other-team"])
}

@Test func loadTeamsThrowsWithStderrWhenTheCommandFails() {
    #expect {
        try loadTeams(exec: { _, _ in CommandResult(status: 1, stdout: "", stderr: "boom: no manifest\n") })
    } throws: { "\($0)".contains("boom: no manifest") }
    #expect {
        try loadTeams(exec: { _, _ in throw CommandError(description: "node: not found") })
    } throws: { "\($0)".contains("node: not found") }
}

@Test func loadTeamsThrowsOnBadJSON() {
    #expect { try loadTeams(exec: { _, _ in ok("not json") }) } throws: { "\($0)".contains("bad JSON") }
}

@Test func toTeamStripsTheWindowSuffixAndDerivesAttachedFromClients() throws {
    let teams = try rawTeams().map { toTeam($0, clients: clients) }
    #expect(teams[0].sessionName == "my-team-demo-team-mvtepzfv")
    #expect(teams[0].attached == true)
    #expect(teams[1].attached == false)
    #expect(teams[0].startedAt == "2026-10-31T01:00:00.000Z")
}

@Test func toTeamMapsWorkerFields() throws {
    let w = toTeam(try rawTeams()[0], clients: clients).workers
    #expect(w[0] == WorkerSeed(
        handle: "pane:my-team-demo-team-mvtepzfv:%38", workerName: "alpha", role: "orchestrator",
        description: "Demo orchestrator", paneId: "%38", alive: true, agent: .claude, cwd: "/Users/me/alpha",
        spool: 0, inbox: 0, sentPending: 2, oldestPendingAt: "2026-10-31T05:10:00.000Z",
        stateFile: StateFile(state: "idle", reason: "waiting for replies", updatedAt: nil)
    ))
    // spool + unread, no state/reason
    #expect(w[1].agent == .codex)
    #expect(w[1].spool == 1)
    #expect(w[1].inbox == 1)
    #expect(w[1].stateFile == nil)
    // dead worker, unknown agent type, missing role/description
    #expect(w[2].alive == false)
    #expect(w[2].agent == .claude)
    #expect(w[2].role == nil)
    #expect(w[2].description == "")
    #expect(w[2].handle == "pane:my-team-demo-team-mvtepzfv:%40")
    #expect(w[2].stateFile == StateFile(state: "done", reason: nil, updatedAt: nil))
}

// MARK: - claude (test/sources/claude.test.js)

private let sid = "065c71b5-0000-4000-8000-000000000001"
private let base = SessionJson(
    pid: 10005, sessionId: sid, cwd: "/Users/me/x", startedAt: 1793270113003, procStart: "Thu Oct 29 10:35:09 2026",
    status: "idle", statusUpdatedAt: 1793428333676, updatedAt: 1793428333000, name: "x-77", entrypoint: "cli",
    tmux: "my-team-demo-mvtepzfv:@5.%42"
)

@Test func transcriptDirNameReplacesEveryNonAlphanumericChar() {
    #expect(transcriptDirName("/Users/me/my_proj.v2") == "-Users-me-my-proj-v2")
    // UTF-16 units, as JS: an astral char is two dashes, a BMP char one
    #expect(transcriptDirName("/a/한😀") == "-a----")
}

@Test func fromSessionJsonMapsATmuxSession() {
    let want = "/p/-Users-me-x/\(sid).jsonl"
    let rec = fromSessionJson(base, isAlive: { _ in true }, transcriptExists: { $0 == want }, projectsDir: "/p")
    #expect(rec == ClaudeRecord(
        pid: 10005, sessionId: sid, cwd: "/Users/me/x",
        startedAt: "2026-10-29T10:35:13.003Z", procStart: "2026-10-29T10:35:09.000Z", status: .wait,
        since: "2026-10-31T06:32:13.676Z", name: "x-77", entrypoint: "cli",
        tmux: TmuxRef(session: "my-team-demo-mvtepzfv", window: "@5", pane: "%42"), transcript: want
    ))
}

@Test func fromSessionJsonWithoutTmuxBusyUpdatedAtFallbackNoTranscript() {
    var json = base
    json.tmux = nil
    json.statusUpdatedAt = nil
    json.status = "busy"
    let rec = fromSessionJson(json, isAlive: { _ in true }, transcriptExists: { _ in false }, projectsDir: "/nonexistent")
    #expect(rec?.tmux == nil)
    #expect(rec?.status == .busy)
    #expect(rec?.since == "2026-10-31T06:32:13.000Z")
    #expect(rec?.transcript == nil)
}

@Test func fromSessionJsonReturnsNilForADeadPid() {
    #expect(fromSessionJson(base, isAlive: { _ in false }) == nil)
}

@Test func loadClaudeSessionsKeepsLiveOnlySkipsBadJsonAndFindsMovedTranscripts() throws {
    let root = FileManager.default.temporaryDirectory.appending(path: "ct-claude-\(UUID().uuidString)").path
    defer { try? FileManager.default.removeItem(atPath: root) }
    let dir = "\(root)/sessions", projectsDir = "\(root)/projects"
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(atPath: "\(projectsDir)/moved-dir", withIntermediateDirectories: true)
    FileManager.default.createFile(atPath: "\(projectsDir)/moved-dir/\(sid).jsonl", contents: Data())
    let me = Int(ProcessInfo.processInfo.processIdentifier)
    func write(_ name: String, _ text: String) { FileManager.default.createFile(atPath: "\(dir)/\(name)", contents: Data(text.utf8)) }
    let json = { (pid: Int) in #"{"pid":\#(pid),"sessionId":"\#(sid)","cwd":"/Users/me/x","startedAt":1793270113003,"status":"idle"}"# }
    write("\(me).json", json(me))
    write("999999.json", json(999999))
    write("1.json", "{not json")
    write("\(me).abc.key", "x")

    let recs = loadClaudeSessions(dir: dir, projectsDir: projectsDir)
    #expect(recs.map(\.pid) == [me])
    #expect(recs.first?.transcript == "\(projectsDir)/moved-dir/\(sid).jsonl")
}

@Test func loadClaudeSessionsOnAMissingDirReturnsNothing() {
    #expect(loadClaudeSessions(dir: "/nonexistent/sessions").isEmpty)
}
