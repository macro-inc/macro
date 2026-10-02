import Foundation
import CryptoKit
import UIKit
import UniformTypeIdentifiers
import SwiftUI
import AVKit

struct ChannelUploadFile: Sendable {
    var url: URL
    var name: String
    var contentType: String
    var sha: String
    var checksum: String
    var width: Double?
    var height: Double?
    var entityType: String {
        contentType.hasPrefix("image/") ? "static/image" : contentType.hasPrefix("video/") ? "static/video" : "document"
    }
    nonisolated static func importFile(_ source: URL) throws -> ChannelUploadFile {
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let values = try source.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true, let size = values.fileSize, size <= 2_000_000_000 else { throw ChannelUploadError.tooLarge }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("macro-channel-upload-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        let copy = folder.appendingPathComponent(source.lastPathComponent)
        do {
            try FileManager.default.copyItem(at: source, to: copy)
            return try inspect(copy)
        } catch { try? FileManager.default.removeItem(at: folder); throw error }
    }
    nonisolated static func photo(_ data: Data) throws -> ChannelUploadFile {
        guard let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.94) else { throw ChannelUploadError.unreadablePhoto }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("macro-channel-upload-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent("Photo-\(UUID().uuidString.prefix(8)).jpg")
        do {
            try jpeg.write(to: file, options: [.atomic, .completeFileProtection])
            return try inspect(file)
        } catch { try? FileManager.default.removeItem(at: folder); throw error }
    }
    nonisolated private static func inspect(_ url: URL) throws -> ChannelUploadFile {
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        var hasher = SHA256()
        while let data = try file.read(upToCount: 1_048_576), !data.isEmpty { hasher.update(data: data) }
        let hash = Data(hasher.finalize())
        let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let image = type.hasPrefix("image/") ? UIImage(contentsOfFile: url.path) : nil
        return ChannelUploadFile(url: url, name: url.lastPathComponent, contentType: type,
            sha: hash.map { String(format: "%02x", $0) }.joined(), checksum: hash.base64EncodedString(),
            width: image.map { Double($0.size.width * $0.scale) }, height: image.map { Double($0.size.height * $0.scale) })
    }
    nonisolated func remove() { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
}

enum ChannelUploadError: LocalizedError {
    case tooLarge, unreadablePhoto, invalidResponse, uploadFailed, status(Int)
    var errorDescription: String? {
        switch self {
        case .tooLarge: "Choose a file smaller than 2 GB."
        case .unreadablePhoto: "This photo couldn't be opened. Please choose another."
        case .invalidResponse: "The upload service returned an unexpected response."
        case .uploadFailed: "The file couldn't finish uploading. Try again before sending."
        case .status(let code): "The upload service couldn't complete the request (\(code))."
        }
    }
}

@MainActor
final class ChannelAttachmentUploader {
    let session: NativeSession
    init(session: NativeSession) { self.session = session }
    static func mediaURL(_ id: String, environment: MacroEnvironment) -> URL {
        mediaOrigin(environment).appendingPathComponent("file").appendingPathComponent(id)
    }
    static func mediaOrigin(_ environment: MacroEnvironment) -> URL {
        URL(string: environment == .production ? "https://static-file-service.macro.com" : "https://static-file-service-dev.macro.com")!
    }
    /// Agent prompts use ACP resource links, so all file types go to static storage.
    func uploadPromptFile(_ file: ChannelUploadFile) async throws -> URL {
        if session.isDemo { return Self.mediaURL("demo-agent-file-" + UUID().uuidString, environment: session.environment) }
        struct Response: Decodable { var id: String; var upload_url: String }
        let response = try JSONDecoder().decode(Response.self, from: await mediaRequestData(Self.mediaRequest(file, environment: session.environment)))
        do {
            guard let url = URL(string: response.upload_url), url.scheme == "https" else { throw ChannelUploadError.invalidResponse }
            var request = URLRequest(url: url, timeoutInterval: 300)
            request.httpMethod = "PUT"
            request.setValue(file.contentType, forHTTPHeaderField: "Content-Type")
            let transport = Self.transport()
            defer { transport.finishTasksAndInvalidate() }
            let (_, result) = try await transport.upload(for: request, fromFile: file.url)
            guard let result = result as? HTTPURLResponse, (200..<300).contains(result.statusCode) else { throw ChannelUploadError.uploadFailed }
        } catch {
            var remove = URLRequest(url: Self.mediaOrigin(session.environment).appendingPathComponent("api/file/" + response.id))
            remove.httpMethod = "DELETE"
            _ = try? await mediaRequestData(remove)
            throw error
        }
        return Self.mediaURL(response.id, environment: session.environment)
    }
    func upload(_ file: ChannelUploadFile) async throws -> MessageAttachment {
        if session.isDemo {
            return MessageAttachment(id: UUID().uuidString, entityID: "demo-upload-\(UUID().uuidString)", entityType: file.entityType, width: file.width, height: file.height)
        }
        let id: String
        let uploadURL: String
        let contentType: String
        if file.entityType == "document" {
            struct Metadata: Decodable { var documentId: String }
            struct Payload: Decodable { var documentMetadata: Metadata; var presignedUrl: String?; var contentType: String? }
            struct Response: Decodable { var data: Payload }
            let request = try Self.documentRequest(file, gateway: session.environment.gatewayURL)
            let response = try JSONDecoder().decode(Response.self, from: await session.authenticatedData(for: request))
            guard let signed = response.data.presignedUrl else { throw ChannelUploadError.invalidResponse }
            id = response.data.documentMetadata.documentId; uploadURL = signed; contentType = response.data.contentType ?? file.contentType
        } else {
            struct Response: Decodable { var id: String; var upload_url: String }
            let request = try Self.mediaRequest(file, environment: session.environment)
            let response = try JSONDecoder().decode(Response.self, from: await mediaRequestData(request))
            id = response.id; uploadURL = response.upload_url; contentType = file.contentType
        }
        do {
            let request = try Self.uploadRequest(file, url: uploadURL, contentType: contentType)
            let transport = Self.transport()
            defer { transport.finishTasksAndInvalidate() }
            let (_, response) = try await transport.upload(for: request, fromFile: file.url)
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { throw ChannelUploadError.uploadFailed }
        } catch {
            // Roll back only the brand-new file allocated by this failed upload.
            var remove = URLRequest(url: file.entityType == "document"
                ? session.environment.gatewayURL.appendingPathComponent("dss/documents/\(id)")
                : Self.mediaOrigin(session.environment).appendingPathComponent("api/file/\(id)"))
            remove.httpMethod = "DELETE"
            if file.entityType == "document" { _ = try? await session.authenticatedData(for: remove) }
            else { _ = try? await mediaRequestData(remove) }
            throw error
        }
        return MessageAttachment(id: UUID().uuidString, entityID: id, entityType: file.entityType, width: file.width, height: file.height)
    }
    static func documentRequest(_ file: ChannelUploadFile, gateway: URL) throws -> URLRequest {
        var request = URLRequest(url: gateway.appendingPathComponent("dss/documents"), timeoutInterval: 30)
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["documentName": file.name, "sha": file.sha, "mimeType": file.contentType])
        return request
    }
    static func mediaRequest(_ file: ChannelUploadFile, environment: MacroEnvironment) throws -> URLRequest {
        var request = URLRequest(url: mediaOrigin(environment).appendingPathComponent("api/file"), timeoutInterval: 30)
        request.httpMethod = "PUT"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["file_name": file.name, "content_type": file.contentType])
        return request
    }
    static func uploadRequest(_ file: ChannelUploadFile, url: String, contentType: String) throws -> URLRequest {
        guard let url = URL(string: url), url.scheme == "https" else { throw ChannelUploadError.invalidResponse }
        var request = URLRequest(url: url, timeoutInterval: 300)
        request.httpMethod = "PUT"; request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        if file.entityType == "document" { request.setValue(file.checksum, forHTTPHeaderField: "x-amz-checksum-sha256") }
        return request
    }
    private static func transport() -> URLSession {
        let config = URLSessionConfiguration.ephemeral; config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        return URLSession(configuration: config)
    }
    private func mediaRequestData(_ input: URLRequest) async throws -> Data {
        guard input.url?.host == Self.mediaOrigin(session.environment).host, input.url?.scheme == "https" else { throw NativeSessionError.unsafeURL }
        var request = input
        request.setValue("Bearer \(try await session.macroAPIToken())", forHTTPHeaderField: "Authorization")
        let transport = Self.transport()
        defer { transport.finishTasksAndInvalidate() }
        var (data, response) = try await transport.data(for: request)
        if (response as? HTTPURLResponse)?.statusCode == 401 {
            session.invalidateAPIToken()
            request.setValue("Bearer \(try await session.macroAPIToken())", forHTTPHeaderField: "Authorization")
            (data, response) = try await transport.data(for: request)
        }
        guard let response = response as? HTTPURLResponse else { throw ChannelUploadError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else { throw ChannelUploadError.status(response.statusCode) }
        return data
    }
}

struct ChannelMediaAttachmentView: View {
    let session: NativeSession
    let attachment: MessageAttachment
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @State private var player: AVPlayer?
    private var url: URL { ChannelAttachmentUploader.mediaURL(attachment.entityID, environment: session.environment) }
    var body: some View {
        NavigationStack {
            Group {
                if session.isDemo { ContentUnavailableView("Preview attachment", systemImage: "photo", description: Text("Local preview does not load files from the network.")) }
                else if attachment.entityType == "static/video" { VideoPlayer(player: player).onAppear { player = AVPlayer(url: url) }.onDisappear { player?.pause() } }
                else {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image { image.resizable().scaledToFit().scaleEffect(scale).gesture(MagnificationGesture().onChanged { scale = max(1, min($0, 4)) }.onEnded { _ in scale = 1 }) }
                        else if phase.error != nil { ContentUnavailableView("Couldn't load photo", systemImage: "photo.badge.exclamationmark") }
                        else { ProgressView() }
                    }
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity).background(.black)
                .navigationTitle(attachment.entityType == "static/video" ? "Video" : "Photo").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
