import Foundation
import TowerCore

struct CommandError: LocalizedError {
    let argv: [String]
    let output: String
    var errorDescription: String? { "\(argv.joined(separator: " ")) failed: \(output)" }
}

/// Runs a focus plan's argv arrays in order, without a shell. Stops at the
/// first failing command. Focus is the only thing the app ever does to a pane.
enum FocusRunner {
    static func run(_ commands: [[String]]) async throws {
        for argv in commands {
            try await exec(argv)
        }
    }

    /// No shell parses anything. A GUI app's PATH lacks Homebrew, so `tmux` is
    /// TowerCore's resolved path; `open` lives in /usr/bin.
    private static func exec(_ argv: [String]) async throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: argv[0] == "tmux" ? towerTmuxBin : "/usr/bin/\(argv[0])")
        p.arguments = Array(argv.dropFirst())
        let err = Pipe()
        p.standardError = err
        p.standardOutput = FileHandle.nullDevice
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            p.terminationHandler = { p in
                if p.terminationStatus == 0 { return c.resume() }
                let text = String(decoding: err.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                c.resume(throwing: CommandError(argv: argv, output: text.trimmingCharacters(in: .whitespacesAndNewlines)))
            }
            do { try p.run() } catch { c.resume(throwing: error) }
        }
    }
}
