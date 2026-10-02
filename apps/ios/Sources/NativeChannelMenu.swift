import SwiftUI

enum NativeChannelTab: String, CaseIterable, Identifiable {
    case messages, attachments, calls, participants
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var icon: String {
        switch self { case .messages: "chat-centered"; case .attachments: "paperclip"; case .calls: "phone"; case .participants: "users" }
    }
}

struct NativeChannelMenu: View {
    let session: NativeSession
    let store: ChatStore
    let channel: Channel
    let selected: NativeChannelTab
    let onSelect: (NativeChannelTab) -> Void
    let onAsk: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var favorite: Bool?
    @State private var muted: Bool?
    @State private var busy = false
    @State private var error: String?
    @State private var renaming = false
    @State private var name = ""
    @ScaledMetric(relativeTo: .body) private var scalePoints: CGFloat = 17
    private var scale: CGFloat { scalePoints / 16 }
    private var item: WorkspaceItem { .init(id: channel.id, kind: .channel, title: store.title(for: channel), entityType: "channel") }

    var body: some View {
        NativeFloatingDrawer(onDismiss: { dismiss() }) {
            NativeDrawerScrollView {
                VStack(alignment: .leading, spacing: 12 * scale) {
                    Text("View").font(.system(size: 12 * scale)).foregroundStyle(.secondary).padding(.horizontal, 12)
                    group {
                        ForEach(NativeChannelTab.allCases) { tab in
                            row(tab.title, icon: tab.icon, selected: selected == tab) { choose { onSelect(tab) } }
                        }
                    }
                    Text("Actions").font(.system(size: 12 * scale)).foregroundStyle(.secondary).padding(.horizontal, 12)
                    group { row("Ask Macro", icon: "sparkle") { choose(onAsk) } }
                    group {
                        row("Copy Link", icon: "link") { UIPasteboard.general.url = session.environment.webURL.appendingPathComponent("channel/" + channel.id); dismiss() }
                        row("Copy ID", icon: "copy") { UIPasteboard.general.string = channel.id; dismiss() }
                    }
                    group {
                        row(favorite == true ? "Unfavorite" : "Favorite", icon: "star") {
                            mutate { try await WorkspaceService(session: session).setFavorite(item: item, favorite: favorite != true); favorite = favorite != true }
                        }.disabled(favorite == nil || busy)
                        row(muted == true ? "Unmute notifications" : "Mute notifications", icon: muted == true ? "bell" : "bell-slash") {
                            mutate { try await NativeChannelDetailsAPI(session: session).setMuted(channel.id, muted: muted != true); muted = muted != true }
                        }.disabled(muted == nil || busy)
                    }
                    if channel.channelType != "direct_message" && channel.isParticipant {
                        group { row("Rename", icon: "pencil-line") { name = store.title(for: channel); renaming = true } }
                    }
                    if let error { Text(error).font(.system(size: 13)).foregroundStyle(.secondary).padding(.horizontal, 12) }
                }.padding(.horizontal, 12)
            }
        }
        .task {
            do {
                async let current = WorkspaceService(session: session).item(item)
                async let mutedValue = NativeChannelDetailsAPI(session: session).isMuted(channel.id)
                favorite = try await current.isFavorite; muted = try await mutedValue
            } catch { self.error = error.localizedDescription }
        }
        .alert("Rename channel", isPresented: $renaming) {
            TextField("Channel name", text: $name)
            Button("Cancel", role: .cancel) { }
            Button("Save") { mutate { try await NativeChannelDetailsAPI(session: session).rename(channel.id, name: name); await store.refreshChannels() } }
        }
    }
    private func group<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0, content: content).padding(4).background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 24))
    }
    private func row(_ title: String, icon: String, selected: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12 * scale) {
                MacroIcon(name: icon, size: 16 * scale)
                Text(title).font(.system(size: 14 * scale))
                Spacer()
                if selected { MacroIcon(name: "check", size: 14 * scale).foregroundStyle(MacroTheme.accent) }
            }.padding(.horizontal, 12 * scale).frame(minHeight: 44 * scale).contentShape(Rectangle())
                .background(selected ? Color.primary.opacity(0.07) : .clear, in: RoundedRectangle(cornerRadius: 22))
        }.buttonStyle(.plain).foregroundStyle(.primary).accessibilityIdentifier("channel-menu-" + title.lowercased().replacingOccurrences(of: " ", with: "-"))
    }
    private func choose(_ action: @escaping () -> Void) { dismiss(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: action) }
    private func mutate(_ operation: @escaping @MainActor () async throws -> Void) {
        busy = true; error = nil
        Task { do { try await operation(); dismiss() } catch { self.error = error.localizedDescription }; busy = false }
    }
}

@MainActor
struct NativeChannelDetailsAPI {
    let session: NativeSession
    func isMuted(_ channelID: String) async throws -> Bool {
        if session.isDemo { return false }
        let data = try await request("notification/unsubscribe")
        let value = try JSONDecoder().decode(WorkspaceJSON.self, from: data)
        return value.array.contains { $0["item_id"].string == channelID && $0["item_type"].string == "channel" }
    }
    func setMuted(_ channelID: String, muted: Bool) async throws {
        guard !session.isDemo else { return }
        _ = try await request("notification/unsubscribe/item/channel/" + component(channelID), method: muted ? "POST" : "DELETE")
    }
    func rename(_ channelID: String, name: String) async throws {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw WorkspaceError.invalidName }
        guard !session.isDemo else { return }
        _ = try await request("dss/channels/" + component(channelID), method: "PATCH", body: .object(["channel_name": .string(name)]))
    }
    func attachments(_ channelID: String, type: String, cursor: String? = nil) async throws -> ChannelAttachmentPage {
        guard !session.isDemo else { return .init(items: [], nextCursor: nil) }
        var query = [URLQueryItem(name: "limit", value: "50"), URLQueryItem(name: "attachment_type", value: type)]
        if let cursor { query.append(.init(name: "cursor", value: cursor)) }
        return try JSONDecoder().decode(ChannelAttachmentPage.self, from: await request("dss/channels/" + component(channelID) + "/attachments", query: query))
    }
    private func component(_ id: String) -> String { id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(.init(charactersIn: "/?#%"))) ?? id }
    private func request(_ path: String, method: String = "GET", body: WorkspaceJSON? = nil, query: [URLQueryItem] = []) async throws -> Data {
        let url = session.environment.gatewayURL.appendingPathComponent(path).appending(queryItems: query)
        var request = URLRequest(url: url); request.httpMethod = method
        if let body { request.httpBody = try JSONEncoder().encode(body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return try await session.authenticatedData(for: request)
    }
}

struct ChannelAttachmentPage: Decodable {
    var items: [MessageAttachment]
    var nextCursor: String?
    enum CodingKeys: String, CodingKey { case items; case nextCursor = "next_cursor" }
}
