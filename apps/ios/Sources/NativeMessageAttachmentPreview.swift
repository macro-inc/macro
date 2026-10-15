import SwiftUI
import UIKit
import ImageIO

/// Inline media stays native; tapping preserves the conversation's existing viewer route.
struct NativeMessageAttachmentPreview: View {
    let attachment: MessageAttachment
    let session: NativeSession
    let onOpen: () -> Void
    @State private var image: UIImage?
    @State private var failed = false
    @State private var title: String?

    private var isImage: Bool { attachment.entityType == "static/image" }
    private var ratio: CGFloat {
        if let width = attachment.width, let height = attachment.height,
           width.isFinite, height.isFinite, width > 0, height > 0 { return width / height }
        // Missing metadata must not change a row's height when a download finishes
        // during a fling. Fit the image within the same reserved preview bounds.
        return 4 / 3
    }

    var body: some View {
        Button(action: onOpen) {
            if isImage {
                ZStack {
                    Color(uiColor: .secondarySystemBackground)
                    if let image { Image(uiImage: image).resizable().scaledToFit() }
                    else if session.isDemo { Image(systemName: "photo").font(.system(size: 38)).foregroundStyle(.secondary) }
                    else if failed { Image(systemName: "photo").font(.system(size: 28)).foregroundStyle(.secondary) }
                    else { ProgressView().tint(.secondary) }
                }
                .aspectRatio(ratio, contentMode: .fit)
                .frame(maxWidth: 360, maxHeight: 320, alignment: .leading)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.primary.opacity(0.08), lineWidth: 0.5))
            } else {
                Label(title ?? fallbackTitle, systemImage: isImage ? "photo" : attachment.entityType == "static/video" ? "play.rectangle" : "doc.text")
                    .font(.system(size: 14)).lineLimit(2).padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isImage ? "Open photo attachment" : title ?? fallbackTitle)
        .accessibilityIdentifier("message-attachment-\(attachment.id)")
        .task(id: attachment.entityType + ":" + attachment.entityID) { await load() }
    }

    private var fallbackTitle: String {
        if isImage { return "Open photo" }
        if attachment.entityType == "static/video" { return "Open video" }
        return "Open attachment"
    }

    private func load() async {
        guard !session.isDemo else { return }
        if isImage {
            do {
                let url = ChannelAttachmentUploader.mediaURL(attachment.entityID, environment: session.environment)
                let loaded = try await NativeAttachmentThumbnails.shared.image(url: url)
                guard !Task.isCancelled else { return }
                image = loaded; failed = false
            } catch { if !Task.isCancelled { failed = true } }
        } else if attachment.entityType == "document" {
            let key = session.environment.rawValue + ":" + (session.userID ?? "") + ":" + attachment.entityID
            if let cached = NativeAttachmentTitles.shared.object(forKey: key as NSString) { title = cached as String; return }
            let placeholder = WorkspaceItem(id: attachment.entityID, kind: .document, title: "Attachment", entityType: "document")
            if let item = try? await WorkspaceService(session: session).item(placeholder), !Task.isCancelled {
                title = item.title
                NativeAttachmentTitles.shared.setObject(item.title as NSString, forKey: key as NSString)
            }
        }
    }
}

@MainActor
private enum NativeAttachmentTitles {
    static let shared: NSCache<NSString, NSString> = {
        let cache = NSCache<NSString, NSString>(); cache.countLimit = 300; return cache
    }()
}

/// Downloads go to temporary files and decode off the main actor at thumbnail size.
/// No account credentials are sent to public static-file URLs or persisted in a disk cache.
private actor NativeAttachmentThumbnails {
    static let shared = NativeAttachmentThumbnails()
    private let cache: NSCache<NSURL, UIImage> = {
        let cache = NSCache<NSURL, UIImage>()
        cache.countLimit = 48; cache.totalCostLimit = 24 * 1_024 * 1_024
        return cache
    }()
    private let transport: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }()
    private var requests: [URL: Task<UIImage, Error>] = [:]

    func image(url: URL) async throws -> UIImage {
        if let cached = cache.object(forKey: url as NSURL) { return cached }
        if let pending = requests[url] { return try await pending.value }
        let transport = transport
        let request = Task.detached(priority: .utility) {
            let (file, response) = try await transport.download(for: URLRequest(url: url, timeoutInterval: 25))
            defer { try? FileManager.default.removeItem(at: file) }
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
                  let source = CGImageSourceCreateWithURL(file as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
                  let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceShouldCacheImmediately: true,
                    kCGImageSourceThumbnailMaxPixelSize: 1_024,
                  ] as CFDictionary) else { throw ChannelUploadError.invalidResponse }
            return UIImage(cgImage: thumbnail)
        }
        requests[url] = request
        defer { requests[url] = nil }
        let loaded = try await request.value
        let cost = loaded.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
        cache.setObject(loaded, forKey: url as NSURL, cost: cost)
        return loaded
    }
}
