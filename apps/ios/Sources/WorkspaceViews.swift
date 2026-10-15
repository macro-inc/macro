import SwiftUI

@MainActor @Observable
final class NativeWorkspaceStore {
    var items: [WorkspaceItem] = []
    var cursor: String?
    var loading = false
    var error: String?
    var lastDone: WorkspaceItem?
    private var generation = 0
    let service: WorkspaceService
    init(session: NativeSession) { service = WorkspaceService(session: session) }
    func load(_ collection: WorkspaceCollection, folder: String? = nil, more: Bool = false, filter: WorkspaceListFilter = .init()) async {
        if more && (loading || cursor == nil) { return }
        generation += 1; let request = generation
        loading = true; error = nil
        do {
            let page = try await (folder.map { id in Task { try await service.folder(id, cursor: more ? cursor : nil, filter: filter) } }
                ?? Task { try await service.list(collection, cursor: more ? cursor : nil, filter: filter) }).value
            guard request == generation else { return }
            if more { let known = Set(items.map(\.id)); items += page.items.filter { !known.contains($0.id) } }
            else { items = page.items }
            cursor = page.nextCursor; loading = false
        } catch { if request == generation { self.error = error.localizedDescription; loading = false } }
    }
    func done(_ item: WorkspaceItem) async {
        do { try await service.setDone(item: item); lastDone = item; items.removeAll { $0.id == item.id } }
        catch { self.error = error.localizedDescription }
    }
    func undoDone() async {
        guard let item = lastDone else { return }
        do { try await service.setDone(item: item, done: false); items.insert(item, at: 0); lastDone = nil }
        catch { self.error = error.localizedDescription }
    }
    func seen(_ item: WorkspaceItem) async {
        do {
            try await service.markSeen(item: item)
            if let index = items.firstIndex(where: { $0.id == item.id }) { items[index].isUnread = false }
        } catch { /* Reading a cached item remains possible while offline. */ }
    }
    func favorite(_ item: WorkspaceItem) async {
        do {
            try await service.setFavorite(item: item, favorite: !item.isFavorite)
            if let index = items.firstIndex(where: { $0.id == item.id }) { items[index].isFavorite.toggle() }
        } catch { self.error = error.localizedDescription }
    }
    func complete(_ item: WorkspaceItem) async {
        do {
            try await service.setTaskCompleted(item: item, completed: !item.isCompleted)
            if let index = items.firstIndex(where: { $0.id == item.id }) { items[index].status = item.isCompleted ? "Not started" : "Completed" }
        } catch { self.error = error.localizedDescription }
    }
}

struct WorkspaceResourceView: View {
    let tab: NativeTab
    let session: NativeSession
    let chat: ChatStore
    var createRequest = 0
    var refreshRequest = 0
    var onDetailChange: (Bool) -> Void = { _ in }
    var folder: WorkspaceItem? = nil
    @State private var model: NativeWorkspaceStore
    @State private var collection: WorkspaceCollection
    @State private var showFilters = false
    @State private var unreadOnly = false
    @State private var favoriteOnly = false
    @State private var selectedKind: WorkspaceKind?
    @State private var showCreate = false
    @State private var loadedQuery = ""
    @State private var selectedItem: WorkspaceItem?
    @State private var detailPresented = false
    @State private var renameItem: WorkspaceItem?
    @State private var renameValue = ""
    @State private var openingItemID: String?
    @State private var selectedRowID: String?
    @State private var creatingDocument = false

    init(tab: NativeTab, session: NativeSession, chat: ChatStore, createRequest: Int = 0, refreshRequest: Int = 0, onDetailChange: @escaping (Bool) -> Void = { _ in }, folder: WorkspaceItem? = nil) {
        self.tab = tab; self.session = session; self.chat = chat; self.createRequest = createRequest; self.refreshRequest = refreshRequest
        self.onDetailChange = onDetailChange; self.folder = folder
        _model = State(initialValue: NativeWorkspaceStore(session: session))
        _collection = State(initialValue: tab == .home ? .signal : tab == .tasks ? .tasks : tab == .agents ? .agents : tab == .calls ? .calls : .recent)
    }
    private var tabs: [(WorkspaceCollection, String)] {
        if folder != nil { return [] }
        switch tab {
        case .home: return [(.signal, "Signal"), (.noise, "Noise")]
        case .files: return [(.recent, "Recent"), (.myFiles, "My Files"), (.sharedFiles, "Shared with me"), (.folders, "Folders")]
        default: return []
        }
    }
    private var filtered: [WorkspaceItem] {
        let result = model.items.filter { (!activeFilter.unreadOnly || $0.isUnread) && (!activeFilter.favoritesOnly || $0.isFavorite) && (activeFilter.kind == nil || $0.kind == activeFilter.kind) }
        return result
    }
    var body: some View {
        let rows = filtered
        VStack(spacing: 0) {
            List {
                if let error = model.error { NativeErrorRow(error: error) { Task { await reload() } } }
                if model.loading && model.items.isEmpty { ProgressView().frame(maxWidth: .infinity).listRowSeparator(.hidden).listRowBackground(MacroTheme.background) }
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, item in
                    if tab == .home && (index == 0 || EmailDateGrouping.title(rows[index - 1].date) != EmailDateGrouping.title(item.date)) {
                        Text(EmailDateGrouping.title(item.date)).font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
                            .listRowInsets(EdgeInsets(top: index == 0 ? 4 : 16, leading: 24, bottom: 4, trailing: 16))
                            .listRowBackground(MacroTheme.background).listRowSeparator(.hidden)
                    }
                    Button { open(item) } label: {
                        Group { if tab == .files { NativeFileRow(item: item) } else if tab == .agents { NativeAgentListRow(item: item) } else { WorkspaceItemRow(item: item, compact: tab == .home, chat: chat) } }
                    }.buttonStyle(NativeListRowButtonStyle(selected: selectedRowID == item.id))
                        .disabled(openingItemID != nil)
                        .accessibilityIdentifier("workspace-item-\(item.id)")
                        .listRowBackground(MacroTheme.background)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets())
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            if tab == .home { Button("Done", systemImage: "checkmark") { Task { await model.done(item) } }.tint(.green) }
                            if item.kind == .task { Button(item.isCompleted ? "Reopen" : "Complete", systemImage: "checkmark.circle") { Task { await model.complete(item) } }.tint(.green) }
                        }
                        .swipeActions(edge: .leading, allowsFullSwipe: false) {
                            if item.canFavorite { Button(item.isFavorite ? "Unfavorite" : "Favorite", systemImage: item.isFavorite ? "star.slash" : "star") { Task { await model.favorite(item) } }.tint(.orange) }
                        }
                        .contextMenu {
                            if item.canFavorite { Button(item.isFavorite ? "Remove favorite" : "Favorite", systemImage: "star") { Task { await model.favorite(item) } } }
                            if item.canRename { Button("Rename", systemImage: "pencil") { renameValue = item.title; renameItem = item } }
                        }
                }
                if model.cursor != nil { Button("Load more") { Task { await model.load(collection, folder: folder?.id, more: true, filter: activeFilter) } }.disabled(model.loading).frame(maxWidth: .infinity) }
                if filtered.isEmpty && !model.loading && model.error == nil {
                    ContentUnavailableView(emptyTitle, systemImage: tab.symbol, description: Text(emptyDescription))
                        .listRowSeparator(.hidden).listRowBackground(MacroTheme.background)
                }
            }.listStyle(.plain).scrollContentBackground(.hidden).scrollDismissesKeyboard(.interactively).refreshable { await reload() }
                .simultaneousGesture(DragGesture(minimumDistance: 12).onChanged { value in
                    if abs(value.translation.height) > abs(value.translation.width) {
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    }
                })
                .accessibilityIdentifier("workspace-list-\(loadedQuery == queryID && !model.loading ? "ready" : "loading")-\(collection.rawValue)")
                .nativeChromeInset()
                .safeAreaInset(edge: .top, spacing: 0) {
                    NativePillBar(options: tabs.map { ($0.0.rawValue, $0.1) }, selection: Binding(get: { collection.rawValue }, set: { collection = WorkspaceCollection(rawValue: $0) ?? .recent }), filterAction: { showFilters = true }, filterIdentifier: "workspace-filters")
                        .background { LinearGradient(colors: [MacroTheme.background.opacity(0.8), .clear], startPoint: .top, endPoint: .bottom) }
                }
        }
        .background(MacroTheme.background)
        .navigationTitle(folder?.title ?? tab.title).navigationBarTitleDisplayMode(.inline)
        .toolbar(folder == nil ? .hidden : .visible, for: .navigationBar)
        .navigationDestination(isPresented: $detailPresented) {
            if let item = selectedItem {
                WorkspaceDestination(item: item, session: session, chat: chat, service: model.service, onChange: { updated in
                    if let index = model.items.firstIndex(where: { $0.id == updated.id }) { model.items[index] = updated }
                })
                .onAppear { onDetailChange(true); Task { await model.seen(item) } }
            }
        }
        .onAppear { onDetailChange(folder != nil) }
        .onChange(of: detailPresented) { _, presented in if !presented { selectedRowID = nil } }
        .overlay(alignment: .bottom) {
            if model.lastDone != nil {
                HStack { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green); Text("Marked done"); Spacer(); Button("Undo") { Task { await model.undoDone() } } }
                    .font(.subheadline).padding(14).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16)).padding(14)
            }
        }
        .toolbar {
            if folder != nil { ToolbarItem(placement: .topBarTrailing) { Button("New", systemImage: "plus") { createFromButton() }.disabled(creatingDocument) } }
        }
        .task(id: queryID) {
            if loadedQuery != queryID { model.items = []; model.cursor = nil; loadedQuery = queryID }
            await reload()
        }
        .onChange(of: createRequest) { _, _ in createFromButton() }
        .onChange(of: refreshRequest) { _, _ in Task { await reload() } }
        .fullScreenCover(isPresented: $showFilters) { filterSheet.presentationBackground(.clear) }
        .sheet(isPresented: Binding(get: { showCreate && tab != .tasks }, set: { showCreate = $0 }), onDismiss: { Task { await reload() } }) {
            WorkspaceCreateSheet(session: session, service: model.service, isTask: tab == .tasks, parentID: folder?.id)
        }
        .fullScreenCover(isPresented: Binding(get: { showCreate && tab == .tasks }, set: { showCreate = $0 }), onDismiss: { Task { await reload() } }) {
            NativeTaskComposer(session: session, service: model.service, parentID: folder?.id).presentationBackground(.clear)
        }
        .alert("Rename", isPresented: Binding(get: { renameItem != nil }, set: { if !$0 { renameItem = nil } })) {
            TextField("Name", text: $renameValue)
            Button("Cancel", role: .cancel) { renameItem = nil }
            Button("Save") {
                if let item = renameItem { Task { do { try await model.service.rename(item: item, name: renameValue); await reload() } catch { model.error = error.localizedDescription } } }
                renameItem = nil
            }
        }
    }
    private func createFromButton() {
        guard tab == .files else { showCreate = true; return }
        guard !creatingDocument else { return }
        creatingDocument = true
        Task {
            defer { creatingDocument = false }
            do {
                let item = try await model.service.createBlankResource(.document, projectID: folder?.id)
                model.items.insert(item, at: 0); selectedItem = item; detailPresented = true
            } catch { model.error = error.localizedDescription }
        }
    }
    private var activeFilter: WorkspaceListFilter {
        collection == .recent && folder == nil ? .init() : WorkspaceListFilter(unreadOnly: unreadOnly, favoritesOnly: favoriteOnly, kind: selectedKind)
    }
    private var queryID: String { "\(collection.rawValue)|\(activeFilter.unreadOnly)|\(activeFilter.favoritesOnly)|\(activeFilter.kind?.rawValue ?? "all")" }
    private func open(_ item: WorkspaceItem) {
        guard openingItemID == nil else { return }
        selectedRowID = item.id
        guard tab == .home, NativeChannelRoute.needsNotificationTarget(item), !session.isDemo else {
            selectedItem = item; detailPresented = true; return
        }
        openingItemID = item.id
        Task {
            let resolved = (try? await model.service.channelTargetedItem(item)) ?? item
            openingItemID = nil
            selectedItem = resolved; detailPresented = true
        }
    }
    private func reload() async { await model.load(collection, folder: folder?.id, filter: activeFilter) }
    private var emptyTitle: String {
        if unreadOnly || favoriteOnly || selectedKind != nil { return "Nothing matches these filters" }
        if tab == .home { return collection == .signal ? "You're all caught up" : "No noise right now" }
        return "No \(tab.title.lowercased()) yet"
    }
    private var emptyDescription: String {
        if tab == .home { return "New mentions and updates will appear here." }
        return "Pull to refresh, or create something new."
    }
    private var filterSheet: some View {
        WorkspaceFilterDrawer(unreadOnly: $unreadOnly, favoriteOnly: $favoriteOnly, kind: $selectedKind,
            isRecent: collection == .recent && folder == nil, onFileScope: { collection = $0 }, onClose: { showFilters = false })
    }

}

struct NativePillBar: View {
    let options: [(String, String)]
    @Binding var selection: String
    var filterAction: (() -> Void)? = nil
    var filterIdentifier = "view-filters"
    var accessibilityPrefix = "pill-"
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8.5) {
                    if let filterAction {
                        Button(action: filterAction) {
                            MacroIcon(name: "sliders-horizontal", size: 21.25).foregroundStyle(.secondary).frame(width: 42.5, height: 42.5)
                        }.buttonStyle(.plain).nativeGlass().accessibilityLabel("Open filters").accessibilityIdentifier(filterIdentifier)
                    }
                    ForEach(options, id: \.0) { id, label in
                        Button { selection = id; UISelectionFeedbackGenerator().selectionChanged() } label: {
                            Text(label).font(.system(size: 12.75, weight: .medium))
                                .padding(.horizontal, 14.875).frame(height: 42.5)
                                .foregroundStyle(selection == id ? Color.black : Color.secondary)
                                .background(selection == id ? MacroTheme.accent : Color.primary.opacity(0.025), in: Capsule())
                                .overlay(Capsule().stroke(selection == id ? Color.clear : Color.primary.opacity(0.14), lineWidth: 0.75))
                        }.buttonStyle(.plain).accessibilityAddTraits(selection == id ? .isSelected : [])
                            .accessibilityIdentifier("\(accessibilityPrefix)\(id)").id(id)
                    }
                }.padding(.horizontal, 12).padding(.top, 6).padding(.bottom, 12)
            }
            .accessibilityIdentifier("native-pill-bar")
            .onAppear { proxy.scrollTo(selection, anchor: .center) }
            .onChange(of: selection) { _, value in
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { proxy.scrollTo(value, anchor: .center) }
            }
        }.fixedSize(horizontal: false, vertical: true)
    }
}

struct NativeFileRow: View {
    let item: WorkspaceItem
    private var isSheet: Bool { ["spreadsheet", "xlsx", "xls", "csv"].contains(item.fileType?.lowercased() ?? "") }
    private var color: Color { item.kind == .folder ? .orange : isSheet ? Color(red: 0.08, green: 0.78, blue: 0.39) : item.kind == .document ? Color(red: 0.69, green: 0.53, blue: 0.96) : .secondary }
    var body: some View {
        HStack(spacing: 10) {
            MacroIcon(name: item.iconName, size: 17).foregroundStyle(color)
            Text(item.title).font(.system(size: 15.9375, weight: .semibold)).lineLimit(1)
            Spacer(minLength: 6)
            if item.isFavorite { Image(systemName: "star.fill").font(.system(size: 10)).foregroundStyle(.orange) }
            Text(NativeTimestamp.label(item.date)).font(.system(size: 12.75)).foregroundStyle(.secondary).lineLimit(1)
        }.frame(minHeight: 48).contentShape(Rectangle())
    }
}

enum NativeTimestamp {
    static func relative(_ date: Date) -> String {
        let seconds = max(0, Date().timeIntervalSince(date))
        if seconds < 60 { return "Now" }
        if seconds < 3600 { return "\(Int(seconds / 60))m" }
        if seconds < 86400 { return "\(Int(seconds / 3600))h" }
        if seconds < 604800 { return "\(Int(seconds / 86400))d" }
        return label(date)
    }
    static func label(_ date: Date) -> String {
        guard date > .distantPast else { return "" }
        return Calendar.current.isDateInToday(date) ? date.formatted(.dateTime.hour().minute()) : date.formatted(.dateTime.month(.abbreviated).day())
    }
}

struct NativeErrorRow: View {
    let error: String
    let retry: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 8) { Text(error).font(.subheadline).foregroundStyle(.secondary); Button("Try again", action: retry) }
            .padding(.vertical, 8).listRowSeparator(.hidden)
    }
}

struct WorkspaceItemRow: View {
    let item: WorkspaceItem
    var compact = false
    var chat: ChatStore? = nil
    private var display: WorkspaceRowDisplay {
        item.rowDisplay(currentUserID: chat?.userID ?? "", names: chat?.names ?? [:], channels: chat?.channels ?? [])
    }
    var body: some View {
        let row = display
        HStack(alignment: .center, spacing: 12) {
            Group {
                if let avatarName = row.avatarName {
                    AvatarView(name: avatarName, size: 44, photoURL: row.avatarUserID.flatMap { chat?.photos[$0] } ?? row.photoURL)
                } else {
                    ZStack {
                        Circle().fill(Color.secondary.opacity(0.07))
                        MacroIcon(name: row.icon, size: 24).foregroundStyle(.secondary)
                    }.frame(width: 44, height: 44)
                }
            }.accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(row.title).font(.system(size: 15.9375, weight: item.isUnread ? .medium : .regular)).lineLimit(1)
                        .foregroundStyle(item.isUnread ? .primary : .secondary)
                    Spacer(minLength: 5)
                    if item.date > .distantPast { Text(compact ? NativeTimestamp.relative(item.date) : NativeTimestamp.label(item.date)).font(.system(size: 12.75)).foregroundStyle(.tertiary) }
                }
                if let subject = row.subject { Text(subject).font(.system(size: 15.9375)).foregroundStyle(.secondary).lineLimit(1) }
                if let quote = row.quote {
                    HStack(spacing: 8) { Rectangle().fill(Color.primary.opacity(0.07)).frame(width: 2); Text(previewText(row.quoteFragments, fallback: quote)).lineLimit(1) }
                        .font(.system(size: 15.9375)).foregroundStyle(.secondary).frame(height: 18)
                }
                if !row.preview.isEmpty { Text(previewText(row.previewFragments, fallback: row.preview)).font(.system(size: 15.9375)).foregroundStyle(.secondary).lineLimit(row.subject == nil && row.quote == nil ? 2 : 1) }
                if !compact { HStack(spacing: 5) {
                    if item.isUnread { Circle().fill(Color.blue).frame(width: 5, height: 5) }
                    if item.isFavorite { Image(systemName: "star.fill").foregroundStyle(.orange) }
                    Text(row.status)
                }.font(.system(size: 11)).foregroundStyle(.tertiary) }
            }
        }.padding(.vertical, compact ? 12 : 9).frame(maxWidth: .infinity).frame(minHeight: compact ? 80 : 62).contentShape(Rectangle())
            .overlay(alignment: .leading) {
                if compact && item.isUnread { Circle().fill(MacroTheme.accent).frame(width: 7, height: 7).offset(x: -17) }
            }
            .overlay(alignment: .bottom) {
                if compact { Rectangle().fill(Color.primary.opacity(0.07)).frame(height: 0.5).padding(.leading, 56) }
            }
    }
    private func previewText(_ fragments: [WorkspacePreviewText.Fragment], fallback: String) -> AttributedString {
        guard !fragments.isEmpty else { return AttributedString(fallback) }
        return fragments.reduce(into: AttributedString()) { result, fragment in
            var text = AttributedString(fragment.text)
            if fragment.isMention {
                text.foregroundColor = MacroTheme.accent
                text.backgroundColor = MacroTheme.accent.opacity(0.10)
            }
            result += text
        }
    }

}

struct WorkspaceDestination: View {
    let item: WorkspaceItem
    let session: NativeSession
    let chat: ChatStore
    var service: WorkspaceService? = nil
    var onChange: (WorkspaceItem) -> Void = { _ in }
    var body: some View {
        Group {
            if item.kind == .folder {
                WorkspaceResourceView(tab: .files, session: session, chat: chat, folder: item)
            } else if item.kind == .channel {
                if let id = NativeChannelRoute.channelID(for: item), let channel = chat.channels.first(where: { $0.id == id }) {
                    ConversationView(channel: channel, store: chat, session: session,
                        initialMessageID: NativeChannelRoute.target(for: item)?.messageID,
                        initialThreadID: NativeChannelRoute.target(for: item)?.threadID)
                } else {
                    NativeChannelDestination(item: item, session: session, chat: chat, service: service)
                }
            } else if item.kind == .email {
                NativeEmailDestination(session: session, threadID: item.id)
            } else if item.kind == .agent {
                NativeAgentDestination(session: session, item: item, store: chat)
            } else if item.kind == .chat {
                NativeCognitionRoute(session: session, store: chat, id: item.id)
            } else if item.kind == .task {
                NativeTaskDetailView(item: item, session: session, service: service, onChange: onChange)
            } else if item.kind == .call {
                NativeCallDetail(item: item, session: session, chat: chat)
            } else {
                WebWorkspaceView(session: session, url: destinationURL, integratedNavigation: true)
            }
        }.toolbar([.channel, .email, .agent, .document, .chat, .other].contains(item.kind) ? .hidden : .visible, for: .navigationBar)
    }
    private var destinationURL: URL {
        session.environment.webURL.appendingPathComponent(WorkspaceRoutes.path(for: item))
    }

}

struct WorkspaceCreateSheet: View {
    let session: NativeSession
    let service: WorkspaceService
    var isTask = false
    var parentID: String? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "document"
    @State private var name = ""
    @State private var content = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                if !isTask { Picker("Create", selection: $kind) { Text("Document").tag("document"); Text("Folder").tag("folder") }.pickerStyle(.segmented) }
                TextField(isTask ? "Task name" : "Name", text: $name).accessibilityIdentifier("create-name")
                if kind != "folder" { Section(isTask ? "Description" : "Content") { TextEditor(text: $content).frame(minHeight: 160).accessibilityIdentifier("create-content") } }
                if let error { Text(error).foregroundStyle(.red) }
            }.navigationTitle(isTask ? "New task" : kind == "folder" ? "New folder" : "New document").navigationBarTitleDisplayMode(.inline)
                .interactiveDismissDisabled(busy)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
                    ToolbarItem(placement: .confirmationAction) { Button("Create") { Task { await save() } }.disabled(busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                }
        }
    }
    private func save() async {
        busy = true; error = nil
        do {
            if kind == "folder" && !isTask { _ = try await service.createFolder(name: name, parentID: parentID) }
            else { _ = try await service.createDocument(name: name, markdown: content, projectID: parentID, isTask: isTask) }
            dismiss()
        } catch { self.error = error.localizedDescription }
        busy = false
    }
}

private struct NativeCallDetail: View {
    let item: WorkspaceItem
    let session: NativeSession
    let chat: ChatStore
    @State private var record: WorkspaceCallRecord?
    @State private var error: String?
    var body: some View {
        List {
            if let record {
                Section {
                    Label(record.title, systemImage: "phone").font(.title3.weight(.semibold))
                    Text(MessageDate.parse(record.startedAt), format: .dateTime.month(.wide).day().hour().minute()).foregroundStyle(.secondary)
                    if let ms = record.durationMs { Text("\(ms / 60000) minutes") }
                }
                if let summary = record.summary, !summary.isEmpty { Section("Summary") { Text(summary).textSelection(.enabled) } }
                Section("Participants") { ForEach(record.participants, id: \.userId) { person in Text(chat.name(for: person.userId)) } }
                if let url = record.recordingUrl { Link("Play recording", destination: url) }
                Section("Transcript") { ForEach(record.transcript) { segment in VStack(alignment: .leading, spacing: 6) { Text(chat.name(for: segment.speakerId)).font(.caption.weight(.semibold)); Text(segment.content).font(.system(size: 15)).textSelection(.enabled) }.padding(.vertical, 5) } }
            } else if let error { Text(error).foregroundStyle(.secondary) } else { ProgressView() }
        }.navigationTitle("Call").navigationBarTitleDisplayMode(.inline)
            .task { do { record = try await WorkspaceService(session: session).callRecord(item.id) } catch { self.error = error.localizedDescription } }
    }
}
