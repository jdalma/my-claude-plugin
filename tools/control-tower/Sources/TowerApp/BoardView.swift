import SwiftUI
import TowerCore

/// Sidebar of running sessions (teams, then Claude Code and Codex sessions) and history; detail of the selected row.
/// Grouping, wording and search live in Sidebar.swift.
struct BoardView: View {
    let tower: Tower
    @State private var query = ""
    @State private var filter = AgentFilter.all
    @State private var historyLimit = historyPageSize
    @State private var selection: RowID?
    @FocusState private var searchFocused: Bool
    @AppStorage(FontScale.storageKey) private var storedScale = FontScale.standard.value

    private let home = NSHomeDirectory()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let error = tower.myTeamError {
                MyTeamErrorLine(error: error).scaledFont(.callout).padding([.horizontal, .top])
            }
            if let board = tower.board {
                content(board, sidebarModel(board: board, history: tower.history, query: query, filter: filter,
                                             historyLimit: historyLimit, home: home))
            } else {
                ProgressView("수집 중…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .scaledFont(.body)
        .frame(minWidth: 760, minHeight: 440)
        .onChange(of: tower.boardSelectRequest, initial: true) { _, request in
            guard let request else { return }
            query = ""  // a search could hide the requested row
            selection = request
            tower.boardSelectRequest = nil
        }
        .onChange(of: query) { historyLimit = historyPageSize }
        .onChange(of: filter) { historyLimit = historyPageSize }
        .toolbar {
            ToolbarItem {
                TextField("검색", text: $query, prompt: Text("세션, 팀, 워크스페이스, 제목 (⌘K)"))
                    .textFieldStyle(.roundedBorder)
                    .scaledFont(.body)
                    .frame(width: 280 * scale.value)
                    .focused($searchFocused)
            }
            ToolbarItem {
                Menu("보기") {
                    Button("글자 크게") { storedScale = scale.bigger().value }.keyboardShortcut("+")
                    Button("글자 작게") { storedScale = scale.smaller().value }.keyboardShortcut("-")
                    Button("기본 크기") { storedScale = FontScale.standard.value }.keyboardShortcut("0")
                }
            }
        }
        .background {
            Group {
                Button("검색") { searchFocused = true }.keyboardShortcut("k")
                Button("내 차례 목록") { selection = nil }.keyboardShortcut(.escape, modifiers: [])
                Button("글자 크게") { storedScale = scale.bigger().value }.keyboardShortcut("+")
                Button("글자 크게") { storedScale = scale.bigger().value }.keyboardShortcut("=")
                Button("글자 작게") { storedScale = scale.smaller().value }.keyboardShortcut("-")
                Button("기본 크기") { storedScale = FontScale.standard.value }.keyboardShortcut("0")
            }
            .opacity(0)
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
        }
        .environment(\.boardFontScale, scale.value)
    }

    private var scale: FontScale { FontScale(stored: storedScale) }

    private func content(_ board: Board, _ model: SidebarModel) -> some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(model.teams, id: \.name) { team in
                    Section {
                        ForEach(team.rows, id: \.id) { LiveRowView(row: $0).tag($0.id) }
                    } header: {
                        GroupHeader(tag: .team, title: team.name, count: waitingText(team.waiting), tooltip: team.summary)
                    }
                }
                ForEach(model.agents, id: \.agent) { g in
                    Section {
                        ForEach(g.rows, id: \.id) { LiveRowView(row: $0).tag($0.id) }
                    } header: {
                        GroupHeader(tag: .agent(g.agent), title: nil, count: waitingText(g.waiting), tooltip: g.summary)
                    }
                }
                Section {
                    ForEach(model.history, id: \.transcriptPath) { h in
                        HistoryRowView(h: h, now: Date(), home: home).tag(RowID.history(h.transcriptPath))
                    }
                    if model.historyRemaining > 0 {
                        Button("더 보기 (남은 \(model.historyRemaining)개)") { historyLimit += historyPageSize }
                            .buttonStyle(.link)
                    }
                } header: {
                    HStack {
                        Text("기록 · 최근순")
                        Spacer()
                        Picker("에이전트", selection: $filter) {
                            Text("전체").tag(AgentFilter.all)
                            Text("Claude").tag(AgentFilter.claude)
                            Text("Codex").tag(AgentFilter.codex)
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                        .frame(width: 180)
                    }
                }
            }
            .contextMenu(forSelectionType: RowID.self) { ids in
                let h = ids.first.flatMap { historyEntry($0, model) }
                Button("resume 명령 복사") {
                    if let h {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(resumeCopyText(h), forType: .string)
                    }
                }
                .disabled(h == nil)
            } primaryAction: { ids in
                guard let id = ids.first else { return }
                switch id {
                case .live:
                    if let row = model.liveRows.first(where: { $0.id == id }) { tower.focus(row.session.handle) }
                case .history:
                    if let h = historyEntry(id, model) { tower.open(h) }
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) { sidebarHeader(model) }
            .navigationSplitViewColumnWidth(min: 300, ideal: 360, max: 520)
        } detail: {
            DetailView(board: board, model: model, history: tower.history, selection: selection, home: home,
                       select: { id in
                           query = ""  // a search could hide the row
                           selection = id
                       },
                       deselect: { selection = nil },
                       focus: { tower.focus($0.session.handle) })
        }
    }

    private func sidebarHeader(_ model: SidebarModel) -> some View {
        HStack {
            Text("실행 중").scaledFont(.headline, weight: .semibold)
            Spacer()
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(.bar)
    }

    /// The history entry a row stands for: itself, or the entry reading a live session's transcript.
    private func historyEntry(_ id: RowID, _ model: SidebarModel) -> HistorySession? {
        switch id {
        case .history(let path): model.history.first { $0.transcriptPath == path } ?? tower.history.first { $0.transcriptPath == path }
        case .live: model.liveRows.first { $0.id == id }?.matched
        }
    }
}

/// One line, the sidebar's largest text: label `.headline`, team name `.title3`, waiting count `.callout`.
/// Sizes, largest first: group header > live row title (`.body`) > history title, folder (`.callout`) > secondary lines
/// (`.caption1`); paths are tooltips. Names set `.primary` explicitly: a section header otherwise dims them.
/// The group summary is the tooltip.
private struct GroupHeader: View {
    let tag: LineKind
    /// The team's name; nil for an agent group, which shows its label only.
    let title: String?
    let count: String?
    let tooltip: String

    var body: some View {
        HStack(spacing: 6) {
            KindTag(kind: tag, style: .headline)
            if let title { Text(title).scaledFont(.title3, weight: .semibold).foregroundStyle(.primary).lineLimit(1) }
            Spacer(minLength: 8)
            if let count { Text(count).scaledFont(.callout).foregroundStyle(.secondary) }
        }
        .textCase(nil)
        .help(tooltip)
    }
}

private struct LiveRowView: View {
    let row: LiveRow

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            StatusIconView(badge: row.badge, style: .body)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(row.title).scaledFont(.body).foregroundStyle(.primary).lineLimit(1).layoutPriority(1)
                    if let folder = row.shownFolder {
                        Text(folder).scaledFont(.callout).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Text(row.badge.elapsed).scaledFont(.caption1).foregroundStyle(.secondary).fixedSize()
                }
                if !row.line.isEmpty {
                    Text(row.line).scaledFont(.caption1).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        .help(badgeLabel(row.badge) + "\n" + row.path)
    }
}

private struct HistoryRowView: View {
    let h: HistorySession
    let now: Date
    let home: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(historyTitle(h)).scaledFont(.callout).foregroundStyle(.primary).lineLimit(1)
                Text(historySubtitle(h)).scaledFont(.caption1).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(relativeTime(h.updatedAt, now: now)).scaledFont(.caption1).foregroundStyle(.secondary)
        }
        .help(historyTooltip(h, home: home))
    }
}

private struct DetailView: View {
    let board: Board
    let model: SidebarModel
    /// Every history entry: a selected row paged out of `model.history` keeps its detail.
    let history: [HistorySession]
    let selection: RowID?
    let home: String
    let select: (RowID) -> Void
    let deselect: () -> Void
    /// The sidebar's double click on a live row: `Tower.focus`.
    let focus: (LiveRow) -> Void
    @State private var changes = ChangesState()
    @AppStorage(diffTreeVisibleKey) private var treeVisible = true
    @AppStorage(diffTreeWidthKey) private var treeWidth = 240.0
    /// The width while the divider is dragged; stored once the drag ends.
    @State private var draggedWidth: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if selection != nil {
                Button("← 내 차례 목록 (Esc)", action: deselect)
                    .buttonStyle(.link)
                    .scaledFont(.caption1)
                    .padding([.horizontal, .top], 10)
            }
            Group {
                switch selection {
                case .live:
                    if let row = model.liveRows.first(where: { $0.id == selection }) { live(row) } else { empty }
                case .history(let path):
                    if let h = (model.history + history).first(where: { $0.transcriptPath == path }) { past(h) } else { empty }
                case nil:
                    QueueView(model: model, select: select, focus: focus)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            Divider()
            Text("더블 클릭: 실행 중이면 pane으로 이동 · 종료된 세션이면 Ghostty에서 resume · 우클릭: resume 명령 복사")
                .scaledFont(.caption1).foregroundStyle(.secondary)
                .padding(10)
        }
    }

    private var empty: some View {
        Text("세션을 선택하세요").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func live(_ row: LiveRow) -> some View {
        let s = row.session
        let team = row.teamName.flatMap { n in board.teams.first { $0.name == n } }
        return detailBody(
            title: row.title,
            badges: {
                if let team, let role = row.worker?.role { Pill(text: "\(team.name) · \(role)") }
                else if let team { Pill(text: team.name) }
                HStack(spacing: 4) {
                    StatusIconView(badge: row.badge, style: .callout)
                    Text(badgeLabel(row.badge)).scaledFont(.caption1).foregroundStyle(.secondary)
                }
            },
            facts: [
                ("에이전트", agentName(s.agent)),
                ("워크스페이스", abbreviate(s.cwd, home: home)),
                ("branch", row.matched?.branch ?? ""),
                ("tmux", s.tmux.map { t in
                    "\(t.session) · pane \(t.pane)" + (team.map { $0.attached ? " · attached" : " · detached" } ?? "")
                } ?? ""),
                ("메일", row.worker.map { mailSummary([$0], at: board.at) } ?? ""),
            ],
            workspace: s.cwd,
            conversation: [("나", s.lastUser), ("에이전트", s.lastAssistant)])
    }

    private func past(_ h: HistorySession) -> some View {
        detailBody(
            title: historyTitle(h),
            badges: { Text(h.live ? "실행 중" : "종료됨").scaledFont(.caption1).foregroundStyle(.secondary) },
            facts: [
                ("에이전트", agentName(h.agent)),
                ("워크스페이스", abbreviate(h.workspace, home: home)),
                ("branch", h.branch ?? ""),
                ("최근 활동", fullTime(h.updatedAt)),
            ],
            workspace: h.workspace,
            conversation: [("최근 프롬프트", h.lastPrompt ?? "")])
    }

    private func detailBody(title: String, @ViewBuilder badges: () -> some View,
                            facts: [(String, String)], workspace: String, conversation: [(String, String)]) -> some View {
        let badges = badges()
        return HStack(spacing: 0) {
            ScrollViewReader { proxy in
                scrollingBody(title: title, badges: badges, facts: facts, workspace: workspace, conversation: conversation)
                    .onChange(of: changes.scrollTarget) { _, target in
                        guard let target else { return }
                        changes.scrollTarget = nil
                        // reveal may have just inserted the header (a folded section); scroll once it is laid out
                        Task { @MainActor in
                            await Task.yield()
                            withAnimation { proxy.scrollTo(target, anchor: .top) }
                        }
                    }
            }
            if treeVisible, let diff = changes.diff(for: workspace) {
                treeDivider
                ChangeTreeColumn(diff: diff, state: changes).frame(width: draggedWidth ?? clampTreeWidth(treeWidth))
            }
        }
    }

    /// The line left of the tree; dragging it resizes the tree within `treeWidthBounds`.
    private var treeDivider: some View {
        Divider()
            .overlay {
                Color.clear
                    .frame(width: 8)
                    .contentShape(Rectangle())
                    .onHover { inside in if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() } }
                    .gesture(
                        DragGesture(minimumDistance: 1, coordinateSpace: .global)
                            .onChanged { v in draggedWidth = clampTreeWidth(clampTreeWidth(treeWidth) - v.translation.width) }
                            .onEnded { _ in
                                if let draggedWidth { treeWidth = draggedWidth }
                                draggedWidth = nil
                            }
                    )
            }
    }

    private func scrollingBody(title: String, badges: some View,
                               facts: [(String, String)], workspace: String, conversation: [(String, String)]) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text(title).scaledFont(.title2, weight: .bold).lineLimit(2)
                    badges
                }
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 6) {
                    ForEach(facts.filter { !$0.1.isEmpty }, id: \.0) { k, v in
                        GridRow {
                            Text(k).foregroundStyle(.secondary)
                            Text(v).textSelection(.enabled)
                                .scaledFont(.body, design: monoFacts.contains(k) ? .monospaced : .default)
                        }
                    }
                }
                ChangesView(workspace: workspace, at: board.at, state: changes)
                let talk = conversation.filter { !$0.1.isEmpty }
                if !talk.isEmpty {
                    Divider()
                    Text("최근 대화").scaledFont(.headline, weight: .semibold)
                    ForEach(talk, id: \.0) { who, text in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(who).scaledFont(.caption1).foregroundStyle(.secondary)
                            Text(text).textSelection(.enabled)
                        }
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct Pill: View {
    let text: String

    var body: some View {
        Text(text).scaledFont(.caption1)
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(.quaternary, in: .capsule)
    }
}

/// The main area with nothing selected: who is waiting on me, longest first.
private struct QueueView: View {
    let model: SidebarModel
    let select: (RowID) -> Void
    let focus: (LiveRow) -> Void

    var body: some View {
        if model.queue.isEmpty {
            VStack(spacing: 4) {
                Text("내 차례인 세션이 없습니다").foregroundStyle(.secondary)
                if model.working > 0 {
                    Text("작업 중 \(model.working)개").scaledFont(.caption1).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text("내 차례 · \(model.queue.count)").scaledFont(.headline, weight: .semibold)
                    ForEach(model.queue, id: \.id) { row in
                        QueueCard(row: row, focus: { focus(row) }).onTapGesture { select(row.id) }
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

private struct QueueCard: View {
    let row: LiveRow
    let focus: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            StatusIconView(badge: row.badge, style: .body)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(row.title).scaledFont(.body, weight: .semibold).lineLimit(1)
                    KindTag(kind: row.group.kind, style: .caption2)
                    if let name = row.group.name { Text(name).scaledFont(.caption1).lineLimit(1) }
                    if let folder = row.shownFolder {
                        Text(folder).scaledFont(.caption1).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Text(row.badge.elapsed).scaledFont(.caption1).foregroundStyle(.secondary).help(badgeLabel(row.badge))
                }
                if !row.message.isEmpty {
                    Text(row.message).scaledFont(.callout).foregroundStyle(.secondary).lineLimit(3).truncationMode(.tail)
                }
                Button("pane으로 이동", action: focus).scaledFont(.caption1)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 8))
        .contentShape(.rect)
        .help(badgeLabel(row.badge) + "\n" + row.path)
    }
}

/// Detail facts that are paths or identifiers.
private let monoFacts: Set = ["워크스페이스", "branch", "tmux"]
