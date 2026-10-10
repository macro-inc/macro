import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct NativeAgentAttachmentPicker: View {
    let session: NativeSession
    let onSelect: (NativeAgentPromptAttachment) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var showFiles = false
    @State private var showPhotos = false
    @State private var photo: PhotosPickerItem?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Button("Photo Library", systemImage: "photo") { showPhotos = true }
                Button("Choose File", systemImage: "folder") { showFiles = true }
                if busy { ProgressView("Uploading…") }
                if let error { Text(error).font(.caption).foregroundStyle(.secondary) }
            }.disabled(busy).navigationTitle("Attach a file").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) } }
                .interactiveDismissDisabled(busy)
                .fileImporter(isPresented: $showFiles, allowedContentTypes: [.item]) { result in
                    switch result {
                    case .success(let url): Task { await prepareFile(url) }
                    case .failure(let failure): error = failure.localizedDescription
                    }
                }
                .photosPicker(isPresented: $showPhotos, selection: $photo, matching: .images)
                .onChange(of: photo) { _, value in if let value { Task { await preparePhoto(value) } } }
        }
    }

    private func prepareFile(_ url: URL) async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do { try await upload(try await Task.detached { try ChannelUploadFile.importFile(url) }.value) }
        catch { self.error = error.localizedDescription }
    }
    private func preparePhoto(_ photo: PhotosPickerItem) async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            guard let data = try await photo.loadTransferable(type: Data.self) else { throw ChannelUploadError.unreadablePhoto }
            try await upload(try await Task.detached { try ChannelUploadFile.photo(data) }.value)
        } catch { self.error = error.localizedDescription }
    }
    private func upload(_ file: ChannelUploadFile) async throws {
        defer { file.remove() }
        let url = try await ChannelAttachmentUploader(session: session).uploadPromptFile(file)
        let size = try? file.url.resourceValues(forKeys: [.fileSizeKey]).fileSize
        onSelect(.init(uri: url.absoluteString, name: file.name, mimeType: file.contentType, size: size))
        dismiss()
    }
}
