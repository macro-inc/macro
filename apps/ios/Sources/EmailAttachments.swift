import CryptoKit
import Foundation

struct EmailUploadTicket: Decodable, Equatable, Sendable {
    var attachment_id: String
    var content_type: String
    var upload_url: String
}

struct EmailLocalAttachment: Identifiable, Equatable, Sendable {
    var id = UUID()
    var localURL: URL
    var name: String
    var size: Int
    var sha: String
    var checksum: String
    var ticket: EmailUploadTicket?
    var uploaded = false
    static let maximumBytes = 18_000_000

    /// Copy while the file picker grants access. Hashing and disk I/O run away from the UI actor.
    nonisolated static func importFile(_ url: URL) throws -> EmailLocalAttachment {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true, let size = values.fileSize, size < maximumBytes else { throw EmailAttachmentError.tooLarge }
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        guard data.count < maximumBytes else { throw EmailAttachmentError.tooLarge }
        let hash = Data(SHA256.hash(data: data))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("macro-email-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let copy = directory.appendingPathComponent(url.lastPathComponent)
        try data.write(to: copy, options: [.atomic, .completeFileProtection])
        return EmailLocalAttachment(localURL: copy, name: url.lastPathComponent, size: data.count,
            sha: hash.map { String(format: "%02x", $0) }.joined(), checksum: hash.base64EncodedString())
    }
    func removeLocalFile() { try? FileManager.default.removeItem(at: localURL.deletingLastPathComponent()) }
}

struct EmailDraftAttachment: Decodable, Equatable, Identifiable {
    var id: String
    var file_name: String
    var size: Int
}

struct EmailForwardedAttachment: Decodable, Equatable, Identifiable {
    var attachment_id: String
    var filename: String?
    var size_bytes: Int?
    var id: String { attachment_id }
}

enum EmailAttachmentError: LocalizedError {
    case tooLarge, uploadFailed, invalidURL
    var errorDescription: String? {
        switch self {
        case .tooLarge: "Attachments must total less than 18 MB."
        case .uploadFailed: "An attachment couldn't finish uploading. Your email has not been sent. Try again."
        case .invalidURL: "The attachment link is unavailable. Please try again."
        }
    }
}
