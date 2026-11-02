import SwiftUI
import TowerCore

/// Sidebar of running sessions (teams, then workspaces) and history; detail of the selected row.
/// Grouping, wording and search live in Sidebar.swift.
struct BoardView: View {
    let tower: Tower
    @State private var query = ""
    @State private var filter = AgentFilter.all
    @State private var selection: RowID?
    @FocusState private var searchFocused: Bool
    @AppStorage(FontScale.storageKey) private var storedScale = FontScale.standard.value

    private let home = NSHomeDirectory()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let error = tower.myTeamError {
                MyTeamErrorLine(error: error).padding([.horizontal, .top])
            }
            if let board = tower.board {
                content(board, sidebarModel(board: board, history: tower.history, query: query, filter: filter, home: home))
            } else {
                ProgressView("Collecting…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .scaledFont(.body)
        .frame(minWidth: 760, minHeight: 440)
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
                        GroupHeader(group: team.name == model.teams.first?.name ? "my-team" : nil,
                                    title: team.name, detail: team.summary)
                    }
                }
                ForEach(model.workspaces, id: \.path) { ws in
                    Section {
                        ForEach(ws.rows, id: \.id) { LiveRowView(row: $0).tag($0.id) }
                    } header: {
                        GroupHeader(group: ws.path == model.workspaces.first?.path ? "individual" : nil,
                                    title: ws.name, detail: ws.path)
                    }
                }
                Section {
                    ForEach(model.history, id: \.transcriptPath) { h in
                        HistoryRowView(h: h, now: Date(), home: home).tag(RowID.history(h.transcriptPath))
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
            DetailView(board: board, model: model, selection: selection, home: home)
        }
    }

    private func sidebarHeader(_ model: SidebarModel) -> some View {
        HStack {
            Text("실행 중").scaledFont(.headline, weight: .semibold)
            Spacer()
            if model.myTurn > 0 {
                Text("내 차례 \(model.myTurn)")
                    .scaledFont(.caption1, weight: .bold)
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background(Color.orange, in: .capsule)
                    .foregroundStyle(.white)
            }
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

private struct GroupHeader: View {
    /// `my-team` or `individual` above the first group of its kind.
    let group: String?
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let group {
                Text(group).scaledFont(.caption1).foregroundStyle(.secondary).padding(.bottom, 2)
            }
            Text(title).scaledFont(.subheadline, weight: .bold)
            Text(detail).scaledFont(.caption1).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
        }
        .textCase(nil)
    }
}

private struct BadgeView: View {
    let badge: RowBadge

    var body: some View {
        switch badge {
        case .permission:
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.orange).help(badgeLabel(badge))
        case .waitingForUser:
            Text(badgeLabel(badge)).scaledFont(.caption1).foregroundStyle(.orange)
        case .working:
            Text(badgeLabel(badge)).scaledFont(.caption1).foregroundStyle(.blue)
        case .done:
            Label(badgeLabel(badge), systemImage: "checkmark.circle.fill").scaledFont(.caption1).foregroundStyle(.green)
        case .idle:
            Text(badgeLabel(badge)).scaledFont(.caption1).foregroundStyle(.secondary)
        }
    }
}

private struct LiveRowView: View {
    let row: LiveRow

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title).scaledFont(.body).lineLimit(1)
                if !row.line.isEmpty {
                    Text(row.line).scaledFont(.caption1).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            BadgeView(badge: row.badge)
        }
        .help(row.session.cwd)
    }
}

private struct HistoryRowView: View {
    let h: HistorySession
    let now: Date
    let home: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(historyTitle(h)).scaledFont(.body).lineLimit(1)
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
    let selection: RowID?
    let home: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Group {
                switch selection {
                case .live:
                    if let row = model.liveRows.first(where: { $0.id == selection }) { live(row) } else { empty }
                case .history(let path):
                    if let h = model.history.first(where: { $0.transcriptPath == path }) { past(h) } else { empty }
                case nil:
                    empty
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
                BadgeView(badge: row.badge)
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
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text(title).scaledFont(.title2, weight: .bold).lineLimit(2)
                    badges()
                }
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 6) {
                    ForEach(facts.filter { !$0.1.isEmpty }, id: \.0) { k, v in
                        GridRow {
                            Text(k).foregroundStyle(.secondary)
                            Text(v).textSelection(.enabled)
                        }
                    }
                }
                ChangesView(workspace: workspace, at: board.at)
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
