import SwiftUI
import TowerCore

/// Per-repo base the user picked, keyed by repo toplevel. "자동" removes the entry.
private let pinnedKey = "diffBaseByRepo"

private func storedPins() -> [String: String] {
    UserDefaults.standard.dictionary(forKey: pinnedKey) as? [String: String] ?? [:]
}

struct Loaded {
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
    var loaded: Loaded?
    var showCommitted = true
    var showUncommitted = true
    /// Unfolded files; every other file shows its header only, a file new on a refresh included.
    /// Kept by section and path across refreshes and base changes, emptied when the workspace changes.
    private var expanded: Set<DiffFileKey> = []
    private var workspace: String?
    /// The file a tree click asked to scroll to; the detail's scroll view consumes it.
    var scrollTarget: DiffFileKey?

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
struct ChangesView: View {
    let workspace: String
    let at: String
    @Bindable var state: ChangesState
    @AppStorage(diffTreeVisibleKey) private var treeVisible = true

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
            if !Task.isCancelled { state.loaded = next }
        }
    }

    private func content(_ d: WorkspaceDiff, candidates: [String]) -> some View {
        let missing = baseNote(d.base)
        return VStack(alignment: .leading, spacing: 10) {
            header(d, candidates: candidates)
            section("커밋됨", .committed, detail: baseRange(d.base), expanded: $state.showCommitted, section: d.committed, note: missing)
            section("미커밋", .uncommitted, detail: "HEAD → 작업 트리", expanded: $state.showUncommitted, section: d.uncommitted, note: nil)
            if d.hiddenLines > 0 {
                Text("\(d.hiddenLines)줄 더 있음 — 터미널에서 git diff로 확인").scaledFont(.caption1).foregroundStyle(.secondary)
            }
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
                    Counts(added: section.added, removed: section.removed)
                }
            }
        }
    }
}

private struct Counts: View {
    let added: Int
    let removed: Int

    var body: some View {
        HStack(spacing: 4) {
            Text("+\(added)").foregroundStyle(.green)
            Text("−\(removed)").foregroundStyle(.red)
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

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Button(action: toggle) {
                    Image(systemName: folded ? "chevron.right" : "chevron.down").frame(width: 12)
                }
                .buttonStyle(.borderless)
                .help(folded ? "펼치기" : "접기")
                Image(systemName: "doc.text").foregroundStyle(.secondary)
                Text(file.path).scaledFont(.body, weight: .semibold, design: .monospaced)
                    .lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                Spacer()
                if file.binary { Text("바이너리 파일").foregroundStyle(.secondary) } else { Counts(added: file.added, removed: file.removed) }
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(.quaternary)
            if !folded {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(file.lines.enumerated()), id: \.offset) { _, line in LineView(line: line) }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.separator))
    }
}

private struct LineView: View {
    let line: DiffLine

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            if line.kind == .hunk {
                Text(line.text).foregroundStyle(.secondary).padding(.leading, 8)
            } else {
                Text(number(line.old) + " " + number(line.new)).foregroundStyle(.tertiary).padding(.horizontal, 8)
                Text(marker + line.text).foregroundStyle(.primary)
            }
            Spacer(minLength: 0)
        }
        .scaledFont(.caption1, design: .monospaced)
        .textSelection(.enabled)
        .padding(.vertical, 1)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint)
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

    private var tint: Color {
        switch line.kind {
        case .added: .green.opacity(0.18)
        case .removed: .red.opacity(0.18)
        case .hunk: .secondary.opacity(0.12)
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
                        Text("+\(added)").foregroundStyle(.green)
                        Text("−\(removed)").foregroundStyle(.red)
                    case .binary: Text("bin").foregroundStyle(.secondary)
                    case .untracked: Text("새").foregroundStyle(.secondary)
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
