import SwiftUI

struct NativeChannelAttachmentsView: View {
    let session: NativeSession
    let store: ChatStore
    let channel: Channel
    let open: (MessageAttachment) -> Void
    @Environment(\.nativeChromeBottom) private var bottom
    @State private var selection = "Media"
    @State private var pages: [String: ChannelAttachmentPage] = [:]
    @State private var documents: [String: WorkspaceItem] = [:]
    @State private var loading = Set<String>()
    @State private var errors: [String: String] = [:]
    private var type: String { selection == "Media" ? "static" : "dss" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Attachments").font(.system(size: 21.25, weight: .medium))
                HStack(spacing: 8) {
                    ForEach(["Media", "Documents"], id: \.self) { title in
                        Button { selection = title } label: {
                            Text(title).font(.system(size: 14.875)).padding(.horizontal, 14).frame(height: 36)
                                .background(selection == title ? Color.primary.opacity(0.1) : .clear, in: Capsule())
                        }.buttonStyle(.plain).accessibilityIdentifier("channel-attachments-" + title.lowercased())
                    }
                }
                if type == "static" {
                    LazyVGrid(columns: [.init(.flexible()), .init(.flexible()), .init(.flexible())], spacing: 6) {
                        ForEach(pages[type]?.items ?? []) { file in
                            NativeMessageAttachmentPreview(attachment: file, session: session) { open(file) }
                                .frame(height: 112).clipped()
                        }
                    }
                } else {
                    LazyVStack(spacing: 0) {
                        ForEach(pages[type]?.items ?? []) { file in
                            Button { open(file) } label: {
                                HStack(spacing: 12) {
                                    MacroIcon(name: documents[file.entityID]?.iconName ?? "file", size: 20).foregroundStyle(MacroTheme.accent)
                                    Text(documents[file.entityID]?.title ?? "Attachment").font(.system(size: 14.875)).lineLimit(1)
                                    Spacer()
                                }.frame(minHeight: 48).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    }
                }
                if loading.contains(type) { ProgressView().tint(.secondary).frame(maxWidth: .infinity) }
                else if let error = errors[type] {
                    Text(error).foregroundStyle(.secondary).font(.system(size: 14))
                    Button("Try again") { Task { await load(type) } }
                } else if pages[type]?.items.isEmpty == true {
                    Text(type == "static" ? "No media in this channel" : "No documents in this channel")
                        .font(.system(size: 14.875)).foregroundStyle(.secondary).padding(.top, 24).frame(maxWidth: .infinity)
                } else if pages[type]?.nextCursor != nil {
                    Button("Load more") { Task { await load(type) } }.onAppear { Task { await load(type) } }
                }
            }.padding(.horizontal, 16).padding(.top, 76).padding(.bottom, bottom + 20)
        }.scrollDismissesKeyboard(.interactively)
            .task(id: type) { if pages[type] == nil { await load(type) } }
            .accessibilityIdentifier("channel-attachments-view")
    }
    private func load(_ type: String) async {
        guard !loading.contains(type) else { return }
        loading.insert(type); errors[type] = nil
        defer { loading.remove(type) }
        do {
            let previous = pages[type]
            let page = try await NativeChannelDetailsAPI(session: session).attachments(channel.id, type: type, cursor: previous?.nextCursor)
            guard !Task.isCancelled else { return }
            var ids = Set((previous?.items ?? []).map(\.id))
            pages[type] = .init(items: (previous?.items ?? []) + page.items.filter { ids.insert($0.id).inserted }, nextCursor: page.nextCursor == previous?.nextCursor ? nil : page.nextCursor)
            if type == "dss" {
                let references = page.items.map { WorkspaceItem(id: $0.entityID, kind: $0.entityType == "project" ? .folder : .document, title: "Attachment", entityType: $0.entityType) }
                for item in try await WorkspaceService(session: session).items(references) { documents[item.id] = item }
            }
        } catch { if !Task.isCancelled { errors[type] = error.localizedDescription } }
    }
}

struct NativeChannelCallsView: View {
    let session: NativeSession
    let store: ChatStore
    let channel: Channel
    @Environment(\.nativeChromeBottom) private var bottom
    @State private var items: [WorkspaceItem] = []
    @State private var cursor: String?
    @State private var loaded = false
    @State private var loading = false
    @State private var error: String?
    @State private var selected: WorkspaceItem?
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                Text("Calls").font(.system(size: 21.25, weight: .medium)).padding(.bottom, 8)
                ForEach(items) { item in
                    Button { selected = item } label: {
                        HStack(spacing: 12) {
                            MacroIcon(name: "phone", size: 20).foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.title).font(.system(size: 14.875, weight: .medium))
                                Text(item.date, style: .date).font(.system(size: 12.75)).foregroundStyle(.secondary)
                            }
                            Spacer()
                        }.frame(minHeight: 52).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                }
                if loading { ProgressView().tint(.secondary).frame(maxWidth: .infinity) }
                else if let error { Text(error).font(.system(size: 14)).foregroundStyle(.secondary); Button("Try again") { Task { await load() } } }
                else if loaded && items.isEmpty { Text("No calls in this channel").font(.system(size: 14.875)).foregroundStyle(.secondary).padding(.top, 24).frame(maxWidth: .infinity) }
                else if cursor != nil { Button("Load more") { Task { await load() } }.onAppear { Task { await load() } } }
            }.padding(.horizontal, 16).padding(.top, 76).padding(.bottom, bottom + 20)
        }.task { if !loaded { await load() } }
            .navigationDestination(isPresented: Binding(get: { selected != nil }, set: { if !$0 { selected = nil } })) {
                if let selected { WorkspaceDestination(item: selected, session: session, chat: store) }
            }.accessibilityIdentifier("channel-calls-view")
    }
    private func load() async {
        guard !loading else { return }; loading = true; error = nil
        defer { loading = false }
        do {
            let previous = cursor
            let page = try await WorkspaceService(session: session).channelCalls(channelID: channel.id, cursor: cursor)
            var ids = Set(items.map(\.id)); items += page.items.filter { ids.insert($0.id).inserted }
            cursor = page.nextCursor == previous ? nil : page.nextCursor; loaded = true
        } catch { self.error = error.localizedDescription }
    }
}
