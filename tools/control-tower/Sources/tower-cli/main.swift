import Foundation
import TowerCore

// --once: one board snapshot as JSON, the same shape as `control-tower --once`.
// --count: the my-turn count for a tmux status badge; prints nothing when zero.
// --history [--limit N]: interactive Claude Code / Codex sessions on disk as JSON, newest first.
let args = Array(CommandLine.arguments.dropFirst())

func printJSON(_ value: some Encodable) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    print(String(decoding: try encoder.encode(value), as: UTF8.self))
}

if args.contains("--count") {
    let n = myTurnCount(await collect())
    if n > 0 { print(n) }
} else if args.contains("--once") {
    try printJSON(await collect())
} else if args.contains("--history") {
    let limit = args.firstIndex(of: "--limit").flatMap { args.indices.contains($0 + 1) ? Int(args[$0 + 1]) : nil }
    let history = await collectHistory(board: await collect())
    try printJSON(limit.map { Array(history.prefix($0)) } ?? history)
} else {
    FileHandle.standardError.write(Data("usage: tower-cli --once | --count | --history [--limit N]\n".utf8))
    exit(2)
}
