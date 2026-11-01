import SwiftUI
import TowerCore

/// One column per live team, then Claude Code and Codex sessions outside any team.
/// Order, status wording, and summaries come from TowerCore's display rules.
struct BoardView: View {
    let tower: Tower

    var body: some View {
        Group {
            if let board = tower.board {
                ScrollView([.horizontal, .vertical]) {
                    HStack(alignment: .top, spacing: 16) {
                        ForEach(sortTeams(board.teams), id: \.name) { team in
                            TeamColumn(team: team, at: board.at, tower: tower)
                        }
                        ForEach(looseColumns(board), id: \.agent) { col in
                            SessionColumn(title: col.agent == .claude ? "Claude Code" : "Codex",
                                          sessions: col.sessions, at: board.at, tower: tower)
                        }
                    }
                    .padding()
                }
            } else {
                ProgressView("Collecting…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 640, minHeight: 400)
        .toolbar {
            ToolbarItem {
                Text("\(tower.myTurn) my turn").font(.headline)
            }
        }
    }
}

private struct Column<Header: View, Content: View>: View {
    @ViewBuilder let header: Header
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            content
        }
        .frame(width: 280, alignment: .topLeading)
    }
}

private struct TeamColumn: View {
    let team: Team
    let at: String
    let tower: Tower

    /// Same fields as the Node team card's meta line.
    private var meta: String {
        ["\(team.workers.count) workers", team.attached ? "attached" : "detached",
         elapsed(from: team.startedAt, to: at), mailSummary(team.workers, at: at)]
            .filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var body: some View {
        Column {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(team.name).font(.title3.bold())
                    let mine = team.workers.filter(\.myTurn).count
                    if mine > 0 {
                        Text("\(mine) my turn").font(.caption.bold()).foregroundStyle(Color.accentColor)
                    }
                }
                Text(meta).font(.caption).foregroundStyle(.secondary)
                let summary = teamSummary(team)
                if let reason = summary?.reason {
                    Text(reason).font(.callout)
                }
                if let voice = summary?.voice {
                    (Text(voice.workerName).bold() + Text(" ") + Text(voice.lastAssistant))
                        .font(.callout).foregroundStyle(.secondary).lineLimit(4)
                }
                if summary?.reason == nil && summary?.voice == nil {
                    Text("no report yet").font(.callout).foregroundStyle(.tertiary)
                }
            }
        } content: {
            ForEach(sortCards(team.workers), id: \.handle) { w in
                CardButton(card: w, at: at, tower: tower) {
                    let mail = mailSummary([w], at: at)
                    if !mail.isEmpty { Text(mail).font(.caption).foregroundStyle(.secondary) }
                    if let state = w.stateFile?.state {
                        Text([state, w.stateFile?.reason].compactMap { $0 }.joined(separator: " — "))
                            .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
            }
        }
    }
}

private struct SessionColumn: View {
    let title: String
    let sessions: [Session]
    let at: String
    let tower: Tower

    var body: some View {
        Column {
            Text(title).font(.title3.bold())
        } content: {
            ForEach(sessions, id: \.pid) { s in
                CardButton(card: s, at: at, tower: tower) {
                    if let sub = s.subtitle {
                        Text(sub).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    if !s.lastUser.isEmpty {
                        Text(s.lastUser).font(.caption).lineLimit(2)
                    }
                }
            }
        }
    }
}

/// A clickable card: name, status, then the caller's extra lines and the last reply.
private struct CardButton<C: Card, Extra: View>: View {
    let card: C
    let at: String
    let tower: Tower
    @ViewBuilder let extra: Extra

    var body: some View {
        let session = card.session
        let line = statusLine(card, at: at)
        Button { tower.focus(session.handle) } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(card.cardName).font(.headline).lineLimit(1)
                    if session.agent == .codex {
                        Text("codex").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Label(line.label, systemImage: symbol(line.kind))
                    .font(.subheadline)
                    .foregroundStyle(color(line.kind))
                extra
                if !session.lastAssistant.isEmpty {
                    Text(session.lastAssistant).font(.callout).foregroundStyle(.secondary).lineLimit(3)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(.background.secondary, in: .rect(cornerRadius: 8))
            .overlay {
                if session.myTurn {
                    RoundedRectangle(cornerRadius: 8).strokeBorder(Color.accentColor, lineWidth: 2)
                }
            }
        }
        .buttonStyle(.plain)
        .help(session.cwd)
        .accessibilityHint("Focus this session's terminal")
    }
}

func symbol(_ kind: StatusKind) -> String {
    switch kind {
    case .mine: "person.fill.questionmark"
    case .perm: "exclamationmark.shield.fill"
    case .busy: "gearshape.2.fill"
    case .idle: "pause.circle"
    case .dead: "xmark.octagon"
    case .unknown: "questionmark.circle"
    }
}

func color(_ kind: StatusKind) -> Color {
    switch kind {
    case .mine: .accentColor
    case .perm: .orange
    case .busy: .blue
    case .idle, .unknown: .secondary
    case .dead: .red
    }
}
