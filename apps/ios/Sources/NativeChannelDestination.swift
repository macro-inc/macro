import SwiftUI

/// Resolve a channel opened from Home, search, or an attachment without a web detour.
struct NativeChannelDestination: View {
    let item: WorkspaceItem
    let session: NativeSession
    let chat: ChatStore
    let service: WorkspaceService?
    @State private var channel: Channel?
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    init(item: WorkspaceItem, session: NativeSession, chat: ChatStore, service: WorkspaceService? = nil) {
        self.item = item; self.session = session; self.chat = chat; self.service = service
        let route = NativeChannelRoute(item: item, userID: chat.userID)
        _channel = State(initialValue: route?.hasMetadata == true ? route?.channel : nil)
    }

    var body: some View {
        Group {
            if let channel {
                ConversationView(channel: channel, store: chat, session: session,
                    initialMessageID: NativeChannelRoute.target(for: item)?.messageID,
                    initialThreadID: NativeChannelRoute.target(for: item)?.threadID)
            } else {
                VStack(spacing: 0) {
                    HStack {
                        Button { dismiss() } label: { MacroIcon(name: "caret-left", size: 24).frame(width: 40, height: 40) }
                            .buttonStyle(.plain).nativeGlass().accessibilityLabel("Back").accessibilityIdentifier("channel-back")
                        Spacer()
                    }.padding(.horizontal, 12).padding(.top, 6)
                    if let error {
                        ContentUnavailableView {
                            Label("Couldn’t open conversation", systemImage: "bubble.left.and.exclamationmark.bubble.right")
                        } description: { Text(error) }
                        actions: { Button("Try again") { Task { await resolve() } }.buttonStyle(.bordered) }
                    } else { ProgressView("Opening conversation…").frame(maxWidth: .infinity, maxHeight: .infinity) }
                }.background(MacroTheme.background)
            }
        }.toolbar(.hidden, for: .navigationBar)
            .task(id: item.id) { if channel == nil { await resolve() } }
    }

    private func resolve() async {
        error = nil
        guard let route = NativeChannelRoute(item: item, userID: chat.userID) else {
            error = "This message no longer has an available channel."; return
        }
        if let cached = chat.channels.first(where: { $0.id == route.channel.id }) { channel = cached; return }
        if session.isDemo { channel = route.channel; return }
        do {
            // Soup includes is_participant for public channels a viewer can read but has not joined.
            let lookup = WorkspaceItem(id: route.channel.id, kind: .channel, title: item.title, entityType: "channel")
            if let refreshed = try? await (service ?? WorkspaceService(session: session)).item(lookup),
               let projection = NativeChannelRoute(item: refreshed, userID: chat.userID), projection.hasMembership {
                guard !Task.isCancelled else { return }
                channel = projection.channel; return
            }
            try Task.checkCancellation()
            var components = URLComponents(url: session.environment.gatewayURL.appendingPathComponent("dss/channels").appendingPathComponent(route.channel.id), resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "limit", value: "1")]
            let data = try await session.authenticatedData(for: URLRequest(url: components.url!))
            let metadata = try JSONDecoder().decode(NativeChannelMetadata.self, from: data)
            guard metadata.channelID == route.channel.id else { throw MessagingError.invalidResponse }
            guard !Task.isCancelled else { return }
            channel = metadata.channel(for: chat.userID)
        } catch is CancellationError { }
        catch { self.error = error.localizedDescription }
    }
}
