import Foundation

struct PsRow: Decodable, Hashable {
    var pid: Int
    var ppid: Int
    var tty = ""
    var comm = ""
    var args = ""
    var lstart: String?

    init(pid: Int, ppid: Int, tty: String = "", comm: String = "", args: String = "", lstart: String? = nil) {
        self.pid = pid
        self.ppid = ppid
        self.tty = tty
        self.comm = comm
        self.args = args
        self.lstart = lstart
    }

    enum CodingKeys: String, CodingKey { case pid, ppid, tty, comm, args, lstart }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pid = try c.decode(Int.self, forKey: .pid)
        ppid = try c.decode(Int.self, forKey: .ppid)
        tty = try c.decodeIfPresent(String.self, forKey: .tty) ?? ""
        comm = try c.decodeIfPresent(String.self, forKey: .comm) ?? ""
        args = try c.decodeIfPresent(String.self, forKey: .args) ?? ""
        lstart = try c.decodeIfPresent(String.self, forKey: .lstart)
    }
}

private let cLocale = ["LC_ALL": "C"]

// ponytail: BSD ps pads/truncates a non-last `comm` column to 16 chars (MAXCOMLEN).
// comm is unreliable for matching (`/opt/homebrew/li`); match on args instead.
private let commWidth = 16

/// Parses `ps -axo pid=,ppid=,tty=,lstart=,comm=,args=`; lstart is local time.
func parsePs(_ text: String) -> [PsRow] {
    // `  pid  ppid tty  Thu Oct 29 21:15:20 2026     <comm, 16 cols> <args>`
    let psLine = #/\s*(\d+)\s+(\d+)\s+(\S+)\s+\w{3} (\w{3}) +(\d{1,2}) (\d\d):(\d\d):(\d\d) (\d{4})\s+(.*)/#
    return text.split(separator: "\n", omittingEmptySubsequences: false).compactMap { line -> PsRow? in
        guard let m = line.wholeMatch(of: psLine) else { return nil }
        let rest = String(m.10)
        var comm = rest.utf16Slice(0, commWidth)
        while comm.last?.isWhitespace == true { comm.removeLast() }
        return PsRow(
            pid: Int(m.1)!, ppid: Int(m.2)!, tty: String(m.3), comm: comm, args: rest.utf16Slice(commWidth + 1),
            lstart: ctimeISO(month: m.4, day: m.5, hour: m.6, minute: m.7, second: m.8, year: m.9, zone: .current)
        )
    }
}

func psSnapshot() -> [PsRow] {
    guard let r = try? runCommand(["ps", "-axo", "pid=,ppid=,tty=,lstart=,comm=,args="], timeout: 5, env: cLocale),
          r.status == 0 else { return [] }
    return parsePs(r.stdout)
}

/// Picks `keys` out of `ps -E -o command=` output. macOS appends the environment
/// after the args, space separated, so a value runs until the next ` NAME=`.
/// ponytail: a value that itself contains ` NAME=` gets cut short there.
func parseEnv(_ text: String, keys: [String]) -> [String: String] {
    let ns = text as NSString
    let boundaries = try! NSRegularExpression(pattern: #"\s([A-Za-z_][A-Za-z0-9_]*)="#)
        .matches(in: text, range: NSRange(location: 0, length: ns.length))
    var out: [String: String] = [:]
    for key in keys {
        // last occurrence: the env block follows the args, which may contain KEY=… too
        guard let i = boundaries.lastIndex(where: { ns.substring(with: $0.range(at: 1)) == key }) else { continue }
        let start = NSMaxRange(boundaries[i].range)
        let end = i + 1 < boundaries.count ? boundaries[i + 1].range.location : ns.length
        var value = ns.substring(with: NSRange(location: start, length: end - start))
        if value.hasSuffix("\n") { value.removeLast() }
        out[key] = value
    }
    return out
}

func envOf(pid: Int, keys: [String]) -> [String: String] {
    guard let r = try? runCommand(["ps", "-E", "-o", "command=", "-p", String(pid)], timeout: 5, env: cLocale),
          r.status == 0 else { return [:] }
    return parseEnv(r.stdout, keys: keys)
}

/// Ancestor pids of `pid`, nearest first. Stops at 0/1 or after 40 hops.
func ancestors(of pid: Int, in rows: [PsRow]) -> [Int] {
    let parent = Dictionary(rows.map { ($0.pid, $0.ppid) }, uniquingKeysWith: { $1 })
    var out: [Int] = []
    var cur = parent[pid]
    while let p = cur, p > 1, out.count < 40 {
        out.append(p)
        cur = parent[p]
    }
    return out
}

func isDescendant(_ pid: Int, of ancestor: Int, in rows: [PsRow]) -> Bool {
    ancestors(of: pid, in: rows).contains(ancestor)
}
