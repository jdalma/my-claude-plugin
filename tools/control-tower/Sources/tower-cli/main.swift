import Foundation
import TowerCore

// --once: one board snapshot as JSON, the same shape as `control-tower --once`.
// --count: the my-turn count for a tmux status badge; prints nothing when zero.
let args = CommandLine.arguments.dropFirst()

if args.contains("--count") {
    let n = myTurnCount(await collect())
    if n > 0 { print(n) }
} else if args.contains("--once") {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    print(String(decoding: try encoder.encode(await collect()), as: UTF8.self))
} else {
    FileHandle.standardError.write(Data("usage: tower-cli --once | --count\n".utf8))
    exit(2)
}
