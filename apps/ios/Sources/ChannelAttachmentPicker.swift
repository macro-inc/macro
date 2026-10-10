import SwiftUI
import Observation
import PhotosUI
import UniformTypeIdentifiers

/// Selecting an item only stages a reference. The channel's Send action publishes it.
struct ChannelAttachmentPicker: View {
    @Environment(\.dismiss) private var dismiss
    @State private var store: ChannelAttachmentPickerStore
    private let uploader: ChannelAttachmentUploader
    @State private var showsFiles = false
    @State private var showsPhotos = false
    @State private var photo: PhotosPickerItem?
    @State private var isUploading = false
    @State private var uploadName = ""
    let alreadySelected: Set<String>
    let onSelect: (MessageAttachment, String) -> Void
    init(session: NativeSession, alreadySelected: Set<String> = [], onSelect: @escaping (MessageAttachment, String) -> Void) {
        _store = State(initialValue: ChannelAttachmentPickerStore(service: WorkspaceService(session: session)))
        self.uploader = ChannelAttachmentUploader(session: session)
        self.alreadySelected = alreadySelected
        self.onSelect = onSelect
    }
    var body: some View {
        @Bindable var store = store
        NavigationStack {
            List {
                Section {
                    Button("Photo library", systemImage: "photo.on.rectangle") { showsPhotos = true }.accessibilityIdentifier("channel-attachment-photos")
                    Button("Choose from Files", systemImage: "folder") { showsFiles = true }.accessibilityIdentifier("channel-attachment-files")
                }.disabled(isUploading || alreadySelected.count >= 10)
                if isUploading {
                    HStack(spacing: 12) { ProgressView(); Text("Uploading \(uploadName)…").font(.subheadline) }.accessibilityIdentifier("channel-attachment-uploading")
                }
                if alreadySelected.count >= 10 { Text("You can attach up to 10 files to a message.").font(.subheadline).foregroundStyle(.secondary) }
                if let error = store.error {
                    VStack(alignment: .leading, spacing: 8) { Text(error).foregroundStyle(.secondary); Button("Try again") { Task { await store.load() } } }.font(.subheadline)
                }
                if store.isLoading && store.items.isEmpty { HStack { Spacer(); ProgressView("Loading files"); Spacer() }.padding(.vertical, 24) }
                if !store.isLoading && store.items.isEmpty && store.error == nil {
                    ContentUnavailableView("No matching files", systemImage: "doc.text.magnifyingglass", description: Text("Try a different title or refresh your files."))
                }
                ForEach(store.visibleItems) { item in
                    Button {
                        onSelect(MessageAttachment(id: UUID().uuidString, entityID: item.id, entityType: "document"), item.title)
                        dismiss()
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "doc.text").font(.title3).foregroundStyle(.secondary).frame(width: 30)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.title).font(.system(size: 15)).foregroundStyle(.primary).lineLimit(2)
                                Text(item.fileType?.uppercased() ?? "Document").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if alreadySelected.contains(item.id) { Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.accentColor) }
                        }.padding(.vertical, 5)
                    }.disabled(isUploading || alreadySelected.contains(item.id) || alreadySelected.count >= 10).accessibilityIdentifier("channel-file-\(item.id)")
                }
                if store.cursor != nil {
                    Button { Task { await store.loadMore() } } label: {
                        HStack { Spacer(); if store.isLoadingMore { ProgressView() } else { Text("Load more files") }; Spacer() }
                    }.disabled(store.isLoadingMore).accessibilityIdentifier("channel-files-more")
                }
            }
            .listStyle(.plain).refreshable { await store.load() }
            .navigationTitle("Attach a file").navigationBarTitleDisplayMode(.inline)
            .searchable(text: $store.search, prompt: "Search Macro files")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(isUploading).accessibilityIdentifier("channel-attachment-cancel") } }
            .interactiveDismissDisabled(isUploading)
            .fileImporter(isPresented: $showsFiles, allowedContentTypes: [.item], allowsMultipleSelection: false) { result in
                switch result {
                case .success(let urls): if let url = urls.first { Task { await uploadFile(url) } }
                case .failure(let error): store.error = error.localizedDescription
                }
            }
            .photosPicker(isPresented: $showsPhotos, selection: $photo, matching: .images, preferredItemEncoding: .compatible)
            .onChange(of: photo) { _, value in if let value { Task { await uploadPhoto(value) } } }
            .task(id: store.search) {
                if !store.search.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
                guard !Task.isCancelled else { return }
                await store.load()
            }
        }
    }
    private func uploadFile(_ url: URL) async {
        guard !isUploading, alreadySelected.count < 10 else { return }
        isUploading = true; uploadName = url.lastPathComponent; store.error = nil
        defer { isUploading = false }
        do {
            let file = try await Task.detached { try ChannelUploadFile.importFile(url) }.value
            defer { file.remove() }
            let attachment = try await uploader.upload(file)
            onSelect(attachment, file.name); dismiss()
        } catch { store.error = error.localizedDescription }
    }
    private func uploadPhoto(_ photo: PhotosPickerItem) async {
        guard !isUploading, alreadySelected.count < 10 else { return }
        isUploading = true; uploadName = "photo"; store.error = nil
        defer { isUploading = false; self.photo = nil }
        do {
            guard let data = try await photo.loadTransferable(type: Data.self) else { throw ChannelUploadError.unreadablePhoto }
            let file = try await Task.detached { try ChannelUploadFile.photo(data) }.value
            defer { file.remove() }
            let attachment = try await uploader.upload(file)
            onSelect(attachment, file.name); dismiss()
        } catch { store.error = error.localizedDescription }
    }
}

@MainActor @Observable
final class ChannelAttachmentPickerStore {
    let service: WorkspaceService
    var search = ""
    private(set) var items: [WorkspaceItem] = []
    private(set) var cursor: String?
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    var error: String?
    private var generation = 0
    private var listed: WorkspacePage?
    init(service: WorkspaceService) { self.service = service }
    var visibleItems: [WorkspaceItem] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return query.isEmpty || query.count >= 3 ? items : items.filter { $0.title.localizedCaseInsensitiveContains(query) }
    }
    func load() async {
        generation += 1
        let version = generation
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        items = query.count < 3 ? listed?.items ?? [] : []
        cursor = nil; isLoading = true; isLoadingMore = false; error = nil
        defer { if version == generation { isLoading = false } }
        do {
            let page = query.count >= 3 ? try await service.search(query, kind: .document) : try await service.list(.allFiles)
            guard version == generation, !Task.isCancelled else { return }
            items = page.items.filter { $0.kind == .document }; cursor = page.nextCursor
            if query.count < 3 { listed = WorkspacePage(items: items, nextCursor: cursor) }
        } catch { if version == generation && !Task.isCancelled { self.error = error.localizedDescription } }
    }
    func loadMore() async {
        guard let cursor, !isLoading, !isLoadingMore else { return }
        let version = generation
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        isLoadingMore = true
        defer { if version == generation { isLoadingMore = false } }
        do {
            let page = query.count >= 3 ? try await service.search(query, cursor: cursor, kind: .document) : try await service.list(.allFiles, cursor: cursor)
            guard version == generation, !Task.isCancelled else { return }
            var ids = Set(items.map(\.id))
            items += page.items.filter { $0.kind == .document && ids.insert($0.id).inserted }
            self.cursor = page.nextCursor == cursor ? nil : page.nextCursor
            if query.count < 3 { listed = WorkspacePage(items: items, nextCursor: self.cursor) }
        } catch { if version == generation { self.error = error.localizedDescription } }
    }
}
