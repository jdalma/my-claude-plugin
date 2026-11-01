import Foundation

// Read-only: only `my-team status --all --json` is ever run.

/// The sibling `tools/my-team` package, located from this source file as Node locates it from its module.
/// ponytail: a binary moved off this checkout loses it and the board degrades to no teams.
let myTeamBin = URL(fileURLWithPath: #filePath)
    .appending(path: "../../../../../../my-team/bin/my-team")
    .standardizedFileURL.path

struct MyTeamStatus: Decodable {
    var teams: [RawTeam]
}

/// One `.teams[]` entry of `my-team status --all --json`.
struct RawTeam: Decodable {
    var teamName: String
    var session: String
    var startedAt: String?
    var teamAlive: Bool?
    var workers: [RawWorker]
}

struct RawWorker: Decodable {
    var name: String
    var paneId: String
    var cwd: String?
    var agentType: String?
    var role: String?
    var description: String?
    var alive: Bool
    var state: String?
    var reason: String?
    var spool: Int
    var unread: Int
    var sentPending: Int
    var oldestPendingAt: String?

    enum CodingKeys: CodingKey {
        case name, paneId, cwd, agentType, role, description, alive, state, reason, spool, unread, sentPending, oldestPendingAt
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        paneId = try c.decode(String.self, forKey: .paneId)
        cwd = try c.decodeIfPresent(String.self, forKey: .cwd)
        agentType = try c.decodeIfPresent(String.self, forKey: .agentType)
        role = try c.decodeIfPresent(String.self, forKey: .role)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        alive = try c.decode(Bool.self, forKey: .alive)
        // a worker LLM writes its own status.json; a non-string value drops that field, not the team
        state = try? c.decode(String.self, forKey: .state)
        reason = try? c.decode(String.self, forKey: .reason)
        spool = try c.decode(Int.self, forKey: .spool)
        unread = try c.decode(Int.self, forKey: .unread)
        sentPending = try c.decode(Int.self, forKey: .sentPending)
        oldestPendingAt = try c.decodeIfPresent(String.self, forKey: .oldestPendingAt)
    }
}

/// The my-team-owned part of a Team; collect adds the process-level Session fields.
struct TeamSeed: Decodable, Hashable {
    var name: String
    var sessionName: String
    var startedAt: String?
    var attached: Bool
    var workers: [WorkerSeed]
}

struct WorkerSeed: Decodable, Hashable {
    var handle: String
    var workerName: String
    var role: String?
    var description: String
    var paneId: String
    var alive: Bool
    var agent: AgentKind
    var cwd: String?
    var spool: Int
    var inbox: Int
    var sentPending: Int
    var oldestPendingAt: String?
    var stateFile: StateFile?
}

struct MyTeamError: Error, CustomStringConvertible {
    var description: String
}

/// Live teams. Throws on failure; the caller decides.
func loadTeams(
    bin: String = myTeamBin,
    exec: (String, [String]) throws -> CommandResult = { bin, args in try runCommand(["node", bin] + args, timeout: 10) }
) throws -> [RawTeam] {
    let failed = "my-team status --all --json failed: "
    let r: CommandResult
    do {
        r = try exec(bin, ["status", "--all", "--json"])
    } catch {
        throw MyTeamError(description: failed + "\(error)".trimmed)
    }
    guard r.status == 0 else { throw MyTeamError(description: failed + (r.stderr.trimmed.nonEmpty ?? "exit \(r.status)")) }
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    do {
        return try decoder.decode(MyTeamStatus.self, from: Data(r.stdout.utf8)).teams.filter { $0.teamAlive == true }
    } catch {
        throw MyTeamError(description: "my-team status --all --json: bad JSON: \(error)")
    }
}

func toTeam(_ t: RawTeam, clients: [TmuxClient]) -> TeamSeed {
    let sessionName = t.session.replacing(#/:\d+$/#, with: "")
    return TeamSeed(
        name: t.teamName,
        sessionName: sessionName,
        startedAt: t.startedAt,
        attached: clients.contains { $0.session == sessionName },
        workers: t.workers.map { w in
            WorkerSeed(
                handle: "pane:\(sessionName):\(w.paneId)",
                workerName: w.name,
                role: w.role,
                description: w.description ?? "",
                paneId: w.paneId,
                alive: w.alive,
                // ponytail: the model only knows claude|codex; gemini/cursor etc. become claude.
                // collect overwrites agent from the matched process anyway.
                agent: w.agentType == "codex" ? .codex : .claude,
                cwd: w.cwd,
                spool: w.spool,
                inbox: w.unread,
                sentPending: w.sentPending,
                oldestPendingAt: w.oldestPendingAt,
                // updated_at is not in the status output
                stateFile: w.state.nonEmpty != nil || w.reason.nonEmpty != nil
                    ? StateFile(state: w.state, reason: w.reason, updatedAt: nil) : nil
            )
        }
    )
}
