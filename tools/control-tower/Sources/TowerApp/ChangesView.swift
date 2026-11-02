import SwiftUI
import TowerCore

/// Per-repo base the user picked, keyed by repo toplevel. "자동" removes the entry.
private let pinnedKey = "diffBaseByRepo"

private func storedPins() -> [String: String] {
    UserDefaults.standard.dictionary(forKey: pinnedKey) as? [String: String] ?? [:]
}

private struct Loaded {
    var workspace: String
    var result: WorkspaceDiffResult
    var candidates: [String]
}

private struct LoadKey: Hashable {
    var workspace: String
    var at: String
    var pins: [String: String]
}

/// The detail pane's "변경" area: committed and uncommitted changes of the workspace's git repo.
struct ChangesView: View {
    let workspace: String
    let at: String
    @State private var pins = storedPins()
    @State private var loaded: Loaded?
    @State private var showCommitted = true
    @State private var showUncommitted = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            if let loaded, loaded.workspace == workspace {
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
        .task(id: LoadKey(workspace: workspace, at: at, pins: pins)) {
            let (workspace, pins) = (workspace, pins)
            let next = await Task.detached { () -> Loaded in
                let top = repoToplevel(at: workspace)
                let result = workspaceDiff(at: workspace, pinnedBase: top.flatMap { pins[$0] })
                return Loaded(workspace: workspace, result: result, candidates: top.map { baseCandidates(toplevel: $0) } ?? [])
            }.value
            if !Task.isCancelled { loaded = next }
        }
    }

    private func content(_ d: WorkspaceDiff, candidates: [String]) -> some View {
        let missing = baseNote(d.base)
        return VStack(alignment: .leading, spacing: 10) {
            header(d, candidates: candidates)
            section("커밋됨", detail: baseRange(d.base), expanded: $showCommitted, section: d.committed, note: missing)
            section("미커밋", detail: "HEAD → 작업 트리", expanded: $showUncommitted, section: d.uncommitted, note: nil)
            if d.hiddenLines > 0 {
                Text("\(d.hiddenLines)줄 더 있음 — 터미널에서 git diff로 확인").scaledFont(.caption1).foregroundStyle(.secondary)
            }
        }
    }

    private func header(_ d: WorkspaceDiff, candidates: [String]) -> some View {
        let pinned = pins[d.toplevel]
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
        }
    }

    private func setPin(_ base: String?, _ toplevel: String) {
        var next = storedPins()
        next[toplevel] = base
        UserDefaults.standard.set(next, forKey: pinnedKey)
        pins = next
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
    private func section(_ title: String, detail: String, expanded: Binding<Bool>, section: DiffSection?, note: String?) -> some View {
        DisclosureGroup(isExpanded: expanded) {
            if let section {
                SectionBody(section: section)
            } else if let note {
                Text(note).foregroundStyle(.secondary)
            }
        } label: {
            HStack(spacing: 8) {
                Text(title).scaledFont(.subheadline, weight: .semibold)
                if !detail.isEmpty { Text(detail).scaledFont(.caption1, design: .monospaced).foregroundStyle(.secondary) }
                Spacer()
                if let section {
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

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if section.files.isEmpty && section.untracked.isEmpty {
                Text("변경 없음").foregroundStyle(.secondary)
            }
            ForEach(section.files, id: \.path) { FileView(file: $0) }
            ForEach(section.untracked, id: \.self) { path in
                HStack(spacing: 8) {
                    Image(systemName: "doc.badge.plus").foregroundStyle(.secondary)
                    Text(path).scaledFont(.body, design: .monospaced).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Text("새 파일 · 추적 안 함").scaledFont(.caption1).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.top, 4)
    }
}

private struct FileView: View {
    let file: FileDiff

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "doc.text").foregroundStyle(.secondary)
                Text(file.path).scaledFont(.body, weight: .semibold, design: .monospaced)
                    .lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                Spacer()
                if file.binary { Text("바이너리 파일").foregroundStyle(.secondary) } else { Counts(added: file.added, removed: file.removed) }
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(.quaternary)
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(file.lines.enumerated()), id: \.offset) { _, line in LineView(line: line) }
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
