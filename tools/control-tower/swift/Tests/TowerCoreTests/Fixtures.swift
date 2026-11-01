import Foundation

/// `tools/control-tower/test/fixtures`, shared with the Node tests; never copied.
let fixtures = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .appending(path: "../../../test/fixtures")
    .standardizedFileURL

func fixture(_ name: String) throws -> String {
    try String(contentsOf: fixtures.appending(path: name), encoding: .utf8)
}

func fixtureData(_ name: String) throws -> Data {
    try Data(contentsOf: fixtures.appending(path: name))
}
