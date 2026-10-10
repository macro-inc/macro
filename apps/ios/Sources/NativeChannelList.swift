import SwiftUI

struct NativeChannelList: View {
    let session: NativeSession
    let store: ChatStore
    var createRequest = 0
    var onDetailChange: (Bool) -> Void = { _ in }
    @State private var filter = "all"
    @State private var showCreate = false
    @State private var createdChannel: Channel?
    @State private var showCreated = false
    private var filtered: [Channel] {
        store.channels.filter { channel in
            (filter == "all" || (filter == "direct" ? channel.channelType == "direct_message" : channel.channelType != "direct_message"))
        }
    }
    var body: some View {
        VStack(spacing: 0) {
            List {
                if let error = store.channelError { NativeErrorRow(error: error) { Task { await store.refreshChannels() } } }
                if store.status != .connected {
                    HStack(spacing: 8) { ProgressView().controlSize(.mini); Text("Connecting…").font(.caption).foregroundStyle(.secondary) }.listRowSeparator(.hidden)
                }
                ForEach(filtered) { channel in
                    Button { createdChannel = channel; showCreated = true } label: {
                        HStack(spacing: 7) {
                            NativeChannelRow(channel: channel, title: store.title(for: channel), showPreview: filter == "all", photoURL: channel.channelType == "direct_message" ? channel.participants.first(where: { $0.userID != store.userID }).flatMap { store.photos[$0.userID] } : nil)

                        }
                    }.buttonStyle(NativeListRowButtonStyle(selected: showCreated && createdChannel?.id == channel.id, trailing: 14))
                        .accessibilityIdentifier("channel-\(channel.id)")
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(MacroTheme.background)
                }
                if store.nextChannelCursor != nil {
                    Button("Load more conversations") { Task { await store.refreshChannels(more: true) } }.disabled(store.loadingChannels).frame(maxWidth: .infinity)
                }
                if store.loadingChannels && store.channels.isEmpty { ProgressView().frame(maxWidth: .infinity) }
                if filtered.isEmpty && !store.loadingChannels && store.channelError == nil {
                    ContentUnavailableView("No conversations here", systemImage: "bubble.left.and.bubble.right", description: Text("Start a message or try another view."))
                        .listRowSeparator(.hidden).listRowBackground(MacroTheme.background)
                }
            }.listStyle(.plain).scrollContentBackground(.hidden)
                .refreshable { await store.refreshChannels() }
                .nativeChromeInset()
                .safeAreaInset(edge: .top, spacing: 0) {
                    NativePillBar(options: [("all", "Recent"), ("channels", "Channels"), ("direct", "DMs")], selection: $filter)
                }
        }.background(MacroTheme.background)
            .navigationTitle("Channels").navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .onAppear { onDetailChange(false) }
            .onChange(of: createRequest) { _, _ in showCreate = true }
            .navigationDestination(isPresented: $showCreate) {
                NewConversationSheet(session: session, store: store) { channel in
                    createdChannel = channel; showCreate = false
                    Task { try? await Task.sleep(for: .milliseconds(350)); showCreated = true }
                }
            }
            .navigationDestination(isPresented: $showCreated) {
                if let channel = createdChannel { ConversationView(channel: channel, store: store, session: session).onAppear { onDetailChange(true) } }
            }

    }
}

private struct NativeChannelRow: View {
    let channel: Channel
    let title: String
    var showPreview: Bool
    var photoURL: URL?
    @ScaledMetric(relativeTo: .body) private var remPoints: CGFloat = 17
    private var rem: CGFloat { remPoints / 16 }
    var body: some View {
        HStack(spacing: 12 * rem) {
            Group {
                if channel.channelType == "direct_message" { AvatarView(name: title, size: 36 * rem, photoURL: photoURL) }
                else { MacroIcon(name: "hash-straight", size: 18 * rem).foregroundStyle(.secondary).frame(width: 36 * rem, height: 36 * rem) }
            }
            VStack(alignment: .leading, spacing: 6 * rem) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title).font(.system(size: 14 * rem, weight: channel.hasUnread ? .semibold : .medium)).lineLimit(1)
                    Spacer(minLength: 6 * rem)
                    if channel.date > .distantPast {
                        Text(Calendar.current.isDateInToday(channel.date) ? channel.date.formatted(.dateTime.hour().minute()) : channel.date.formatted(.dateTime.month(.abbreviated).day()))
                            .font(.system(size: 12 * rem)).foregroundStyle(.tertiary).lineLimit(1)
                    }
                }
                if showPreview { HStack(alignment: .center) {
                    Text(WorkspaceItem.previewText(channel.preview)).font(.system(size: 14 * rem)).foregroundStyle(.secondary).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)

                } }
            }
        }.frame(minHeight: 80 * rem).contentShape(Rectangle()).overlay(alignment: .leading) { if channel.hasUnread { Circle().fill(MacroTheme.accent).frame(width: 8 * rem, height: 8 * rem).offset(x: -17 * rem, y: -12 * rem) } }
    }
}
