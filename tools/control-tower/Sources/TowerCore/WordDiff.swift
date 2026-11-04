/// In-line change highlighting: which parts of a removed line and the added line that replaced it differ.
/// Ranges are Character offsets into `DiffLine.text`, so a Hangul syllable or an emoji is never cut.

/// Pairs each run of removed lines with the run of added lines right after it, first with first,
/// and marks the changed ranges of every pair similar enough to compare. Unpaired lines stay unmarked.
func markWordChanges(_ lines: inout [DiffLine]) {
    var i = 0
    while i < lines.count {
        guard lines[i].kind == .removed else { i += 1; continue }
        var j = i
        while j < lines.count, lines[j].kind == .removed { j += 1 }
        var k = j
        while k < lines.count, lines[k].kind == .added { k += 1 }
        for n in 0..<min(j - i, k - j) {
            if let (old, new) = changedRanges(lines[i + n].text, lines[j + n].text) {
                lines[i + n].changes = old
                lines[j + n].changes = new
            }
        }
        i = k
    }
}

/// Word-level differences of two lines, or nil when they share under half of their non-space characters
/// (a rewrite, where highlighting everything says nothing) or the comparison would be too large.
func changedRanges(_ a: String, _ b: String) -> (old: [Range<Int>], new: [Range<Int>])? {
    let x = tokens(a), y = tokens(b)
    guard let (keepX, keepY) = commonTokens(x, y) else { return nil }
    let solid = { (ts: [Token]) in ts.reduce(0) { $0 + ($1.space ? 0 : $1.range.count) } }
    let shared = zip(x, keepX).reduce(0) { $0 + ($1.1 && !$1.0.space ? $1.0.range.count : 0) }
    let total = solid(x) + solid(y)
    guard total > 0, shared * 4 >= total else { return nil }  // 2·shared / (a + b) ≥ 1/2
    let old = unkept(x, keepX), new = unkept(y, keepY)
    return old.isEmpty && new.isEmpty ? nil : (old, new)
}

private struct Token {
    var text: Substring
    var range: Range<Int>
    var space: Bool
}

/// Words (letters, digits, `_`), whitespace runs, and every other character on its own.
private func tokens(_ s: String) -> [Token] {
    enum Class { case word, space, other }
    func cls(_ c: Character) -> Class { c.isLetter || c.isNumber || c == "_" ? .word : c.isWhitespace ? .space : .other }
    var out: [Token] = []
    var start = s.startIndex, offset = 0, startOffset = 0
    var current: Class?
    for (idx, c) in zip(s.indices, s) {
        let k = cls(c)
        if let cur = current, cur != k || k == .other {
            out.append(Token(text: s[start..<idx], range: startOffset..<offset, space: cur == .space))
            start = idx
            startOffset = offset
        }
        current = k
        offset += 1
    }
    if let cur = current { out.append(Token(text: s[start...], range: startOffset..<offset, space: cur == .space)) }
    return out
}

/// Which tokens of each side belong to a longest common subsequence. Common head and tail are taken
/// first; the middle runs an O(n·m) table, refused past a million cells (a minified line, say).
private func commonTokens(_ x: [Token], _ y: [Token]) -> ([Bool], [Bool])? {
    var keepX = [Bool](repeating: false, count: x.count), keepY = [Bool](repeating: false, count: y.count)
    var head = 0
    while head < x.count, head < y.count, x[head].text == y[head].text {
        keepX[head] = true; keepY[head] = true; head += 1
    }
    var tail = 0
    while tail < x.count - head, tail < y.count - head, x[x.count - 1 - tail].text == y[y.count - 1 - tail].text {
        keepX[x.count - 1 - tail] = true; keepY[y.count - 1 - tail] = true; tail += 1
    }
    let n = x.count - head - tail, m = y.count - head - tail
    guard n > 0, m > 0 else { return (keepX, keepY) }
    guard n * m <= 1_000_000 else { return nil }
    // lcs[i][j] = LCS length of x[head+i...] and y[head+j...] (middle part only)
    var lcs = [Int32](repeating: 0, count: (n + 1) * (m + 1))
    for i in stride(from: n - 1, through: 0, by: -1) {
        for j in stride(from: m - 1, through: 0, by: -1) {
            lcs[i * (m + 1) + j] = x[head + i].text == y[head + j].text
                ? lcs[(i + 1) * (m + 1) + j + 1] + 1
                : max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1])
        }
    }
    var i = 0, j = 0
    while i < n, j < m {
        if x[head + i].text == y[head + j].text {
            keepX[head + i] = true; keepY[head + j] = true; i += 1; j += 1
        } else if lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1] {
            i += 1
        } else {
            j += 1
        }
    }
    return (keepX, keepY)
}

/// The ranges of tokens outside the common subsequence, neighbors merged.
private func unkept(_ ts: [Token], _ keep: [Bool]) -> [Range<Int>] {
    var out: [Range<Int>] = []
    for (t, k) in zip(ts, keep) where !k {
        if let last = out.last, last.upperBound == t.range.lowerBound {
            out[out.count - 1] = last.lowerBound..<t.range.upperBound
        } else {
            out.append(t.range)
        }
    }
    return out
}
