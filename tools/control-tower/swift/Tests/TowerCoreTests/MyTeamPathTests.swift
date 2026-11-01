import Foundation
import Testing
@testable import TowerCore

private func tempDir() throws -> String {
    let d = FileManager.default.temporaryDirectory.appending(path: "ct-path-\(UUID().uuidString)").path
    try FileManager.default.createDirectory(atPath: d, withIntermediateDirectories: true)
    return d
}

@Test func myTeamOnThePathWinsOverTheCheckoutCopy() throws {
    let empty = try tempDir(), bin = try tempDir()
    defer { for d in [empty, bin] { try? FileManager.default.removeItem(atPath: d) } }
    FileManager.default.createFile(atPath: "\(bin)/my-team", contents: Data("#!/bin/sh\n".utf8), attributes: [.posixPermissions: 0o755])
    #expect(myTeamBinary(in: [empty, bin], fallback: "/checkout/my-team") == "\(bin)/my-team")
}

@Test func withoutMyTeamOnThePathTheCheckoutCopyIsUsed() throws {
    let empty = try tempDir()
    defer { try? FileManager.default.removeItem(atPath: empty) }
    FileManager.default.createFile(atPath: "\(empty)/my-team", contents: Data(), attributes: [.posixPermissions: 0o644]) // not executable
    #expect(myTeamBinary(in: [empty], fallback: "/checkout/my-team") == "/checkout/my-team")
}

@Test func theSearchPathCoversHomebrewForGUIApps() {
    #expect(searchPath.contains("/opt/homebrew/bin"))
    #expect(searchPath.contains("/usr/local/bin"))
}

private func failingDeps(_ teams: @escaping () throws -> [RawTeam]) -> CollectDeps {
    var d = CollectDeps.live
    d.psSnapshot = { [] }
    d.loadTeams = teams
    d.loadCodexSessions = { _ in [] }
    d.listPanes = { [] }
    d.listClients = { [] }
    d.loadClaudeSessions = { [] }
    return d
}

@Test func aFailingMyTeamIsReportedNextToTheBoard() {
    let s = snapshot(deps: failingDeps { throw MyTeamError(description: "my-team status --all --json failed: boom") })
    #expect(s.board.teams.isEmpty)
    #expect(s.myTeamError == "my-team status --all --json failed: boom")
}

@Test func aWorkingMyTeamReportsNoError() {
    #expect(snapshot(deps: failingDeps { [] }).myTeamError == nil)
}
