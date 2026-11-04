import SwiftUI
import TowerCore

/// Per-repo base the user picked, keyed by repo toplevel. "자동" removes the entry.
private let pinnedKey = "diffBaseByRepo"

private func storedPins() -> [String: String] {
    UserDefaults.standard.dictionary(forKey: pinnedKey) as? [String: String] ?? [:]
}

struct Loaded: Equatable {
    var workspace: String
    var result: WorkspaceDiffResult
    var candidates: [String]
}

private struct LoadKey: Hashable {
    var workspace: String
    var at: String
    var pins: [String: String]
}

/// What the "변경" area and the file tree beside it share. The detail pane owns it, so it outlives refreshes.
@MainActor @Observable
final class ChangesState {
    var pins = storedPins()
    /// What the view shows: `fetched`, then the same diff with syntax colors.
    var loaded: Loaded?
    /// The last load as collected, before highlighting. A refresh compares against it, and the
    /// highlight task is keyed on it, so the 5 s refresh never cancels a highlight of the same diff.
    private(set) var fetched: Loaded?
    var showCommitted = true
    var showUncommitted = true
    /// Unfolded files; every other file shows its header only, a file new on a refresh included.
    /// Kept by section and path across refreshes and base changes, emptied when the workspace changes.
    private var expanded: Set<DiffFileKey> = []
    private var workspace: String?
    /// The file a tree click asked to scroll to; the detail's scroll view consumes it.
    var scrollTarget: DiffFileKey?

    /// A refresh's result: shown at once in one color when it differs from the last one.
    func accept(_ next: Loaded) {
        guard next != fetched else { return }
        fetched = next
        loaded = next
    }

    /// Colors `f` and shows it, unless cancelled or superseded meanwhile.
    func highlight(_ f: Loaded?) async {
        guard let f, case .diff(let d) = f.result else { return }
        let lit = await highlighted(d)
        guard !Task.isCancelled, fetched == f else { return }
        loaded = Loaded(workspace: f.workspace, result: .diff(lit), candidates: f.candidates)
    }

    func diff(for workspace: String) -> WorkspaceDiff? {
        guard let loaded, loaded.workspace == workspace, case .diff(let d) = loaded.result else { return nil }
        return d
    }

    /// Unfolds the file and its section, then asks for a scroll to its header.
    func reveal(_ key: DiffFileKey) {
        switch key.part {
        case .committed: showCommitted = true
        case .uncommitted: showUncommitted = true
        }
        expanded.insert(key)
        scrollTarget = key
    }

    func isExpanded(_ key: DiffFileKey) -> Bool { expanded.contains(key) }

    func toggle(_ key: DiffFileKey) {
        if expanded.remove(key) == nil { expanded.insert(key) }
    }

    func setExpanded(_ keys: Set<DiffFileKey>, _ on: Bool) {
        if on { expanded.formUnion(keys) } else { expanded.subtract(keys) }
    }

    /// Another workspace is another repo: its files start folded.
    func select(workspace: String) {
        if workspace != self.workspace { expanded = [] }
        self.workspace = workspace
    }
}

/// `UserDefaults` key of the tree column's visibility.
let diffTreeVisibleKey = "diffTreeVisible"
/// `UserDefaults` key of the tree column's width.
let diffTreeWidthKey = "diffTreeWidth"
let treeWidthBounds: ClosedRange<Double> = 160...480

func clampTreeWidth(_ w: Double) -> Double {
    min(max(w, treeWidthBounds.lowerBound), treeWidthBounds.upperBound)
}

/// The detail pane's "변경" area: committed and uncommitted changes of the workspace's git repo.
/// GitHub's Unified / Split: removed and added lines one above the other, or old left and new right.
/// One choice for every file, stored under `storageKey`.
enum DiffLayout: String, CaseIterable {
    case unified, split

    static let storageKey = "diffLayout"

    var label: String { self == .unified ? "통합" : "나란히" }
    var symbol: String { self == .unified ? "rectangle.split.1x2" : "rectangle.split.2x1" }
}

struct ChangesView: View {
    let workspace: String
    let at: String
    @Bindable var state: ChangesState
    @AppStorage(diffTreeVisibleKey) private var treeVisible = true
    @AppStorage(DiffLayout.storageKey) private var layout = DiffLayout.unified.rawValue

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            if let loaded = state.loaded, loaded.workspace == workspace {
                switch loaded.result {
                case .notARepo:
                    Text("git 저장소 아님").foregroundStyle(.secondary)
                case .diff(let d):
                    content(d, candidates: loaded.candidates)
                }
            } else {
                Text("변경").scaledFont(.headline, weight: .semibold)
                ProgressView().controlSize(.small)
            }
        }
        .onChange(of: workspace, initial: true) { state.select(workspace: workspace) }
        .task(id: LoadKey(workspace: workspace, at: at, pins: state.pins)) {
            let (workspace, pins) = (workspace, state.pins)
            let next = await Task.detached { () -> Loaded in
                let top = repoToplevel(at: workspace)
                let result = workspaceDiff(at: workspace, pinnedBase: top.flatMap { pins[$0] })
                return Loaded(workspace: workspace, result: result, candidates: top.map { baseCandidates(toplevel: $0) } ?? [])
            }.value
            // Reloaded every board refresh (5 s); assigning an unchanged diff would redraw every unfolded line.
            if !Task.isCancelled { state.accept(next) }
        }
        .task(id: state.fetched) { await state.highlight(state.fetched) }
    }

    private func content(_ d: WorkspaceDiff, candidates: [String]) -> some View {
        let missing = baseNote(d.base)
        return VStack(alignment: .leading, spacing: 10) {
            header(d, candidates: candidates)
            section("커밋됨", .committed, detail: baseRange(d.base), expanded: $state.showCommitted, section: d.committed, note: missing)
            section("미커밋", .uncommitted, detail: "HEAD → 작업 트리", expanded: $state.showUncommitted, section: d.uncommitted, note: nil)
        }
    }

    private func header(_ d: WorkspaceDiff, candidates: [String]) -> some View {
        let pinned = state.pins[d.toplevel]
        return HStack(spacing: 8) {
            Text("변경").scaledFont(.headline, weight: .semibold)
            if case .resolved = d.base { Text("base").foregroundStyle(.secondary) }
            Menu {
                Button { setPin(nil, d.toplevel) } label: {
                    if pinned == nil { Label("자동", systemImage: "checkmark") } else { Text("자동") }
                }
                Divider()
                ForEach(candidates, id: \.self) { c in
                    Button { setPin(c, d.toplevel) } label: {
                        if pinned == c { Label(c, systemImage: "checkmark") } else { Text(c) }
                    }
                }
            } label: {
                Text(baseLabel(d.base))
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            if case .resolved(_, let mb) = d.base {
                Text("갈라진 지점").foregroundStyle(.secondary)
                Text(String(mb.prefix(7))).scaledFont(.body, design: .monospaced).textSelection(.enabled)
            }
            Spacer()
            Picker("diff 보기", selection: $layout) {
                ForEach(DiffLayout.allCases, id: \.self) { Label($0.label, systemImage: $0.symbol).tag($0.rawValue) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            .help("통합: 삭제와 추가를 위아래로 · 나란히: 이전은 왼쪽, 이후는 오른쪽")
            Toggle(isOn: $treeVisible) { Label("파일 트리", systemImage: "sidebar.right") }
                .toggleStyle(.button)
                .help(treeVisible ? "파일 트리 숨기기" : "파일 트리 보이기")
        }
    }

    private func setPin(_ base: String?, _ toplevel: String) {
        var next = storedPins()
        next[toplevel] = base
        UserDefaults.standard.set(next, forKey: pinnedKey)
        state.pins = next
    }

    private func baseLabel(_ b: BaseChoice) -> String {
        switch b {
        case .resolved(let ref, _): ref
        case .pinnedMissing(let name): "지정한 base \(name) 없음"
        case .none: "base 브랜치 없음"
        }
    }

    private func baseRange(_ b: BaseChoice) -> String {
        if case .resolved(let ref, _) = b { "\(ref)...HEAD" } else { "" }
    }

    private func baseNote(_ b: BaseChoice) -> String? {
        if case .resolved = b { nil } else { baseLabel(b) }
    }

    @ViewBuilder
    private func section(_ title: String, _ part: DiffPart, detail: String, expanded: Binding<Bool>, section: DiffSection?,
                         note: String?) -> some View {
        DisclosureGroup(isExpanded: expanded) {
            if let section {
                SectionBody(section: section, part: part, state: state)
            } else if let note {
                Text(note).foregroundStyle(.secondary)
            }
        } label: {
            HStack(spacing: 8) {
                Text(title).scaledFont(.subheadline, weight: .semibold)
                if !detail.isEmpty { Text(detail).scaledFont(.caption1, design: .monospaced).foregroundStyle(.secondary) }
                Spacer()
                if let section {
                    if !section.files.isEmpty {
                        let keys = Set(section.files.map { DiffFileKey(part: part, path: $0.path) })
                        Button("모두 접기") { state.setExpanded(keys, false) }.buttonStyle(.link)
                        Button("모두 펼치기") { state.setExpanded(keys, true) }.buttonStyle(.link)
                    }
                    Text("파일 \(section.files.count)").foregroundStyle(.secondary)
                    Counts(added: section.added, removed: section.removed, onCanvas: true)
                }
            }
        }
    }
}

private struct Counts: View {
    let added: Int
    let removed: Int
    /// On the detail pane's GitHub canvas rather than the tree's macOS background.
    var onCanvas = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(changeCounts(added: added, removed: removed), id: \.self) {
                Text($0).foregroundStyle(onCanvas ? ($0.hasPrefix("+") ? DiffColors.addedCount : DiffColors.removedCount) : countColor($0))
            }
        }
        .scaledFont(.body, design: .monospaced)
    }
}

private struct SectionBody: View {
    let section: DiffSection
    let part: DiffPart
    let state: ChangesState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if section.files.isEmpty && section.untracked.isEmpty {
                Text("변경 없음").foregroundStyle(.secondary)
            }
            ForEach(section.files, id: \.path) { file in
                let key = DiffFileKey(part: part, path: file.path)
                FileView(file: file, folded: !state.isExpanded(key)) { state.toggle(key) }
                .id(key)
            }
            ForEach(section.untracked, id: \.self) { path in
                HStack(spacing: 8) {
                    Image(systemName: "doc.badge.plus").foregroundStyle(.secondary)
                    Text(path).scaledFont(.body, design: .monospaced).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Text("새 파일 · 추적 안 함").scaledFont(.caption1).foregroundStyle(.secondary)
                }
                .id(DiffFileKey(part: part, path: path))
            }
        }
        .padding(.top, 4)
    }
}

private struct FileView: View {
    let file: FileDiff
    let folded: Bool
    let toggle: () -> Void
    @AppStorage(DiffLayout.storageKey) private var layout = DiffLayout.unified.rawValue

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Button(action: toggle) {
                    Image(systemName: folded ? "chevron.right" : "chevron.down").frame(width: 12)
                }
                .buttonStyle(.borderless)
                .help(folded ? "펼치기" : "접기")
                Image(systemName: "doc.text").foregroundStyle(DiffColors.mutedText)
                let (dir, name) = splitPath(file.path)
                // the name is what tells files apart: dimmer directory, and a long path loses its head first
                (Text(dir).foregroundStyle(DiffColors.mutedText) + Text(name).fontWeight(.semibold).foregroundStyle(DiffColors.text))
                    .scaledFont(.body, design: .monospaced)
                    .lineLimit(1).truncationMode(.head).textSelection(.enabled)
                    .help(file.path)
                Spacer()
                if file.binary {
                    Text("바이너리 파일").foregroundStyle(DiffColors.mutedText)
                } else {
                    Counts(added: file.added, removed: file.removed, onCanvas: true)
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(DiffColors.header)
            if !folded {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if DiffLayout(rawValue: layout) == .split {
                        ForEach(Array(file.split.enumerated()), id: \.offset) { _, row in SplitRowView(row: row, lines: file.lines) }
                    } else {
                        ForEach(Array(file.lines.enumerated()), id: \.offset) { _, line in
                            LineView(line: line).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                if file.hiddenLines > 0 {
                    Text("\(file.hiddenLines)줄 더 있음 — 터미널에서 git diff로 확인")
                        .scaledFont(.caption1).foregroundStyle(DiffColors.mutedText)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                }
            }
        }
        // GitHub's file box: its canvas under the lines, so translucent diff colors blend as on github.com
        .background(DiffColors.canvas)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(DiffColors.border))
    }
}

/// One side-by-side row: a hunk header across both sides, or the old line beside the new one, an empty
/// cell standing in for a missing side. Both sides share the row's width and its taller height.
struct SplitRowView: View {
    let row: SplitRow
    let lines: [DiffLine]

    var body: some View {
        switch row {
        case .hunk(let i):
            LineView(line: lines[i]).fixedSize(horizontal: false, vertical: true)
        case .pair(let old, let new):
            HStack(alignment: .top, spacing: 0) {
                side(old, .old)
                Rectangle().fill(DiffColors.border).frame(width: 1)
                side(new, .new)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func side(_ i: Int?, _ s: LineView.Side) -> some View {
        Group {
            if let i { LineView(line: lines[i], side: s) } else { DiffColors.emptyCell }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct LineView: View {
    enum Side { case old, new }

    let line: DiffLine
    /// nil: the unified view, both numbers in one cell.
    var side: Side?

    var body: some View {
        // GitHub's three cells, each painted once on the canvas: numbers, the +/− marker, the code.
        // The caller fixes the height, so in a split row each cell fills the taller side.
        HStack(alignment: .top, spacing: 0) {
            Text(numbers)
                .foregroundStyle(line.kind == .context ? DiffColors.mutedText : DiffColors.text)
                .padding(.horizontal, 8).padding(.vertical, 1)
                .frame(maxHeight: .infinity, alignment: .top)
                .background(numberTint)
            HStack(alignment: .top, spacing: 0) {
                if line.kind == .hunk {
                    Text(line.text).foregroundStyle(DiffColors.mutedText).padding(.leading, 8)
                } else {
                    Text(marker).padding(.horizontal, 4)
                    Text(content)
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(DiffColors.text)
            .padding(.vertical, 1)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(tint)
        }
        .scaledFont(.callout, design: .monospaced)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var numbers: String {
        switch side {
        case .old: number(line.old)
        case .new: number(line.new)
        case nil: line.kind == .hunk ? number(nil) + " " + number(nil) : number(line.old) + " " + number(line.new)
        }
    }

    private func number(_ n: Int?) -> String {
        let s = n.map(String.init) ?? ""
        return String(repeating: " ", count: max(0, 5 - s.count)) + s
    }

    private var marker: String {
        switch line.kind {
        case .added: "+"
        case .removed: "−"
        default: " "
        }
    }

    private var content: AttributedString { lineContent(line) }

    private var tint: Color {
        switch line.kind {
        case .added: DiffColors.addedLine
        case .removed: DiffColors.removedLine
        case .hunk: DiffColors.hunkLine
        case .context: .clear
        }
    }

    private var numberTint: Color {
        switch line.kind {
        case .added: DiffColors.addedNumber
        case .removed: DiffColors.removedNumber
        case .hunk: DiffColors.hunkNumber
        case .context: .clear
        }
    }
}

/// The changed files beside the detail, one tree per section; a click reveals the file in the diff.
struct ChangeTreeColumn: View {
    let diff: WorkspaceDiff
    let state: ChangesState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                if let committed = diff.committed { part("커밋됨", .committed, committed) }
                part("미커밋", .uncommitted, diff.uncommitted)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(.background.secondary)
    }

    @ViewBuilder
    private func part(_ title: String, _ part: DiffPart, _ section: DiffSection) -> some View {
        Text(title).scaledFont(.subheadline, weight: .semibold).padding(.top, 6)
        let rows = flatten(changeTree(section))
        if rows.isEmpty { Text("변경 없음").scaledFont(.caption1).foregroundStyle(.secondary) }
        ForEach(rows, id: \.node.path) { depth, node in
            row(node, depth: depth, part: part)
        }
    }

    @ViewBuilder
    private func row(_ node: ChangeTreeNode, depth: Int, part: DiffPart) -> some View {
        switch node.kind {
        case .directory:
            Label(node.name, systemImage: "folder")
                .scaledFont(.caption1).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                .padding(.leading, CGFloat(depth) * 12)
        case .file(let change):
            Button { state.reveal(DiffFileKey(part: part, path: node.path)) } label: {
                HStack(spacing: 4) {
                    Text(node.name).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 4)
                    switch change {
                    case .lines(let added, let removed):
                        ForEach(changeCounts(added: added, removed: removed), id: \.self) { Text($0).foregroundStyle(countColor($0)) }
                    case .binary: Text("bin").foregroundStyle(.secondary)
                    case .untracked: Text("N").foregroundStyle(.secondary)
                    }
                }
                .scaledFont(.caption1, design: .monospaced)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(node.path)
            .padding(.leading, CGFloat(depth) * 12)
        }
    }

    private func flatten(_ nodes: [ChangeTreeNode], depth: Int = 0) -> [(depth: Int, node: ChangeTreeNode)] {
        nodes.flatMap { n -> [(depth: Int, node: ChangeTreeNode)] in
            if case .directory(let children) = n.kind { return [(depth, n)] + flatten(children, depth: depth + 1) }
            return [(depth, n)]
        }
    }
}

private func countColor(_ label: String) -> Color { label.hasPrefix("+") ? DiffColors.treeAddedCount : DiffColors.treeRemovedCount }

/// The text of a diff line. Syntax spans color it; the parts that differ from the paired line sit on the
/// word color, keeping a syntax color only where it reads there. Offsets are into `line.text`, so tabs
/// expand per piece.
func lineContent(_ line: DiffLine) -> AttributedString {
    let chars = Array(line.text)
    var cuts = Set([0, chars.count])
    for r in line.changes { cuts.formUnion([r.lowerBound, r.upperBound]) }
    for s in line.syntax { cuts.formUnion([s.range.lowerBound, s.range.upperBound]) }
    let bounds = cuts.filter { $0 <= chars.count }.sorted()
    var out = AttributedString()
    // changes and syntax are each sorted and disjoint: one pointer each, so a line costs linear time.
    var c = 0, y = 0
    for (a, b) in zip(bounds, bounds.dropFirst()) where a < b {
        while c < line.changes.count, line.changes[c].upperBound <= a { c += 1 }
        while y < line.syntax.count, line.syntax[y].range.upperBound <= a { y += 1 }
        var piece = AttributedString(displayLine(String(chars[a..<b])))
        let onWord = c < line.changes.count && line.changes[c].contains(a)
        if onWord { piece.backgroundColor = line.kind == .added ? DiffColors.addedWord : DiffColors.removedWord }
        if y < line.syntax.count, line.syntax[y].range.contains(a) {
            piece.foregroundColor = DiffColors.syntax(line.syntax[y].kind, onWord: onWord)
        }
        out += piece
    }
    return out
}
