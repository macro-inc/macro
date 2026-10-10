import SwiftUI
import Observation

/// An inline turn summary with the same hierarchy as the channel's Magic Chip.
struct ChannelAgentCard: View {
    let descriptor: ChannelAgentCardDescriptor
    let session: NativeSession
    let onOpen: (String) -> Void
    @State private var feed: ChannelAgentCardFeed?
    @State private var lease = UUID()
    @Environment(\.scenePhase) private var scenePhase
    @ScaledMetric(relativeTo: .body) private var remPoints: CGFloat = 17
    private var rem: CGFloat { remPoints / 16 }

    private var summary: ChannelAgentSummary {
        guard let model = feed?.model else { return .fallback(descriptor.status) }
        if model.record == nil, model.error != nil { return .init(status: "Session unavailable") }
        let turn = descriptor.turn ?? model.cardSummaries.keys.max()
        return turn.flatMap { model.cardSummaries[$0] } ?? .fallback(descriptor.status)
    }
    private var title: String { feed?.model.record.map(Self.agentName) ?? "Agent" }
    private var tone: Color { summary.finished ? .green : summary.waiting ? .orange : .secondary }

    var body: some View {
        VStack(alignment: .leading, spacing: 6 * rem) {
            Button { onOpen(descriptor.sessionID) } label: {
                HStack(spacing: 8 * rem) {
                    if summary.busy { ProgressView().controlSize(.mini).tint(.secondary).frame(width: 20 * rem, height: 20 * rem) }
                    else { Image(systemName: summary.finished ? "checkmark.circle.fill" : summary.waiting ? "questionmark.circle.fill" : "stop.fill").font(.system(size: summary.finished ? 20 * rem : 10 * rem)).foregroundStyle(tone).frame(width: 20 * rem, height: 20 * rem) }
                    Text(title).font(.system(size: 12 * rem, weight: .semibold)).foregroundStyle(.primary).lineLimit(1)
                    Text(summary.status).font(.system(size: 12 * rem)).foregroundStyle(tone).lineLimit(1).padding(.horizontal, 8).padding(.vertical, 3)
                        .background(tone.opacity(summary.finished ? 0.13 : 0.07), in: Capsule())
                    Spacer(minLength: 2)
                    Image(systemName: "arrow.up.right").font(.system(size: 13)).foregroundStyle(.secondary).frame(width: 25, height: 25)
                        .overlay(Circle().stroke(Color.primary.opacity(0.12), lineWidth: 0.5))
                }
            }.frame(height: 24 * rem).buttonStyle(.plain).accessibilityLabel("Open \(title) session")
            if feed?.model.record != nil, let pr = feed?.pullRequest {
                Link(destination: pr.url) {
                    HStack(spacing: 5) {
                        Image(systemName: pr.status == "merged" ? "arrow.triangle.merge" : "arrow.triangle.pull").foregroundStyle(pr.status == "merged" ? .purple : pr.status == "closed" ? .red : .green)
                        Text("#" + pr.number + (pr.title.map { " · " + $0 } ?? "")).lineLimit(1).foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                        if let additions = pr.additions { Text("+\(additions)").foregroundStyle(.green) }
                        if let deletions = pr.deletions { Text("−\(deletions)").foregroundStyle(.red) }
                    }.font(.system(size: 12 * rem, weight: .medium)).frame(height: 32 * rem)
                }.accessibilityLabel("Pull request \(pr.number)").accessibilityIdentifier("channel-agent-pr-" + descriptor.id)
            }
            if feed?.pullRequest == nil {
                Button { onOpen(descriptor.sessionID) } label: {
                    Text(MentionCodec.displayText(in: summary.text.isEmpty ? (summary.busy ? "Nothing written yet" : summary.status) : summary.text))
                        .font(.system(size: 14 * rem)).foregroundStyle(summary.text.isEmpty ? .secondary : .primary)
                        .italic(summary.text.isEmpty).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading).frame(height: 32 * rem).padding(.leading, 28 * rem)
                }.buttonStyle(.plain)
            }
        }.padding(12 * rem).frame(maxWidth: .infinity, alignment: .leading).frame(height: 88 * rem)
            .background(Color(uiColor: .secondarySystemBackground).opacity(0.3), in: RoundedRectangle(cornerRadius: 16 * rem))
            .overlay(RoundedRectangle(cornerRadius: 16 * rem).stroke(Color.primary.opacity(0.11), lineWidth: 1))
            .padding(.vertical, 8 * rem)
            .accessibilityElement(children: .contain).accessibilityIdentifier("channel-agent-card-" + descriptor.id)
            .task {
                let value = ChannelAgentCardFeed.cached(session: session, id: descriptor.sessionID)
                feed = value
                await value.acquire(lease)
            }
            .task(id: feed?.model.record?.pullRequestUrl) { await feed?.refreshPullRequest() }
            .onDisappear { feed?.release(lease) }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await feed?.acquire(lease) } }
                else { feed?.release(lease) }
            }
    }

    private static func agentName(_ record: NativeAgentRecord) -> String {
        let id = record.botId.replacingOccurrences(of: "bot|", with: "")
        let name: String
        switch id {
        case "00000000-0000-0000-0000-00000000c5c5": name = "Cursor"
        case "00000000-0000-0000-0000-00000000c0de": name = "Codex"
        case "00000000-0000-0000-0000-00000000c1a0": name = "Claude Cloud"
        default:
            switch record.harness {
            case "in-memory", "macro-inmem", "sandbox": name = "Macro"
            case "cursor": name = "Cursor"
            case "codex-cloud": name = "Codex"
            case "claude-cloud": name = "Claude Cloud"
            default: name = record.harness.replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " ").capitalized
            }
        }
        return name.hasSuffix(" Agent") ? name : name + " Agent"
    }
}

/// Visible chips for the same session share their REST snapshot and live socket.
/// Releasing the last chip stops foreground work; only a bounded account-scoped
/// snapshot remains so scrolling back does not flash an empty card.
@MainActor @Observable
private final class ChannelAgentCardFeed {
    let model: NativeAgentStore
    private(set) var pullRequest: ChannelAgentPullRequest?
    @ObservationIgnored private let api: NativeAgentAPI
    @ObservationIgnored private var leases = Set<UUID>()
    @ObservationIgnored private var lastUsed = Date()
    @ObservationIgnored private var generation = 0
    private static var cache: [String: ChannelAgentCardFeed] = [:]

    static func cached(session: NativeSession, id: String) -> ChannelAgentCardFeed {
        let key = session.environment.gatewayURL.absoluteString + "|" + (session.userID ?? "demo") + "|" + id
        if let value = cache[key] { value.lastUsed = Date(); return value }
        let api = NativeAgentAPI(session: session)
        let value = ChannelAgentCardFeed(model: NativeAgentStore(id: id, api: api, socket: NativeAgentSocket(session: session)), api: api)
        if cache.count >= 64, let oldest = cache.filter({ $0.value.leases.isEmpty }).min(by: { $0.value.lastUsed < $1.value.lastUsed }) { cache.removeValue(forKey: oldest.key) }
        cache[key] = value
        return value
    }

    init(model: NativeAgentStore, api: NativeAgentAPI) { self.model = model; self.api = api }

    func acquire(_ lease: UUID) async {
        guard leases.insert(lease).inserted else { return }
        guard leases.count == 1 else { return }
        generation += 1; let current = generation
        await model.start()
        guard current == generation else { return }
    }
    func refreshPullRequest() async {
        let current = generation
        if let raw = model.record?.pullRequestUrl, let url = URL(string: raw), ChannelAgentPullRequest.githubKey(url) != nil {
            pullRequest = .init(url: url, number: url.lastPathComponent)
            if let value = try? await api.pullRequest(url), current == generation { pullRequest = value }
        } else { pullRequest = nil }
    }
    func release(_ lease: UUID) {
        leases.remove(lease)
        if leases.isEmpty { generation += 1; model.stopObserving() }
    }
}
