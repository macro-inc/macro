import Foundation
import SwiftUI

enum WorkspaceRoutes {
    static func path(for item: WorkspaceItem) -> String {
        switch item.kind {
        case .task: return "task/\(item.id)"
        case .document:
            let subtype = item.payload["subType"]["type"].string ?? item.payload["sub_type"]["type"].string
            let block = subtype.flatMap { ["snippet", "skill", "task"].contains($0) ? $0 : nil } ?? documentBlock(fileType: item.fileType)
            return "\(block)/\(item.id)"
        case .folder: return "project/\(item.id)"
        case .agent: return "agents/\(item.id)"
        case .chat: return "agents/chat/\(item.id)"
        case .channel: return "channel/\(item.channelID ?? item.id)"
        case .email: return "email/\(item.id)"
        case .calendar: return "calendar/month"
        case .call: return "call/\(item.id)"
        default: return "inbox"
        }
    }
    static func documentBlock(fileType: String?) -> String {
        switch fileType?.lowercased() {
        case "md", "markdown": return "md"
        case "task", "skill", "snippet": return fileType!.lowercased()
        case "pdf", "docx", "write": return "pdf"
        case "spreadsheet", "xlsx", "xls": return "spreadsheet"
        case "canvas": return "canvas"
        case "png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "image": return "image"
        case "mp4", "webm", "mov", "video": return "video"
        case "csv": return "csv"
        case "txt", "json", "yaml", "yml", "toml", "xml", "html", "css", "js", "jsx", "ts", "tsx", "rs", "py", "go", "swift", "c", "cpp", "h", "java", "sql", "sh", "code": return "code"
        default: return "unknown"
        }
    }
}

struct ChannelAttachmentDestination: View {
    let attachment: MessageAttachment
    let session: NativeSession
    let store: ChatStore
    let channel: Channel
    @State private var item: WorkspaceItem?
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        Group {
                if let item { WorkspaceDestination(item: item, session: session, chat: store) }
                else if let error { ContentUnavailableView { Label("Couldn't open attachment", systemImage: "doc.badge.ellipsis") } description: { Text(error) } actions: { Button("Try again") { Task { await resolve() } } } }
                else { ProgressView("Opening attachment…") }
            }
            .task { await resolve() }
    }
    private func resolve() async {
        error = nil
        let kind: WorkspaceKind
        switch attachment.entityType {
        case "document": kind = .document
        case "project": kind = .folder
        case "email", "email_thread": kind = .email
        case "channel": kind = .channel
        case "chat": kind = .chat
        case "agent_session": kind = .agent
        default: kind = .other
        }
        let provisional = WorkspaceItem(id: attachment.entityID, kind: kind, title: "Attachment", entityType: attachment.entityType)
        if kind == .document || kind == .folder {
            do { item = try await WorkspaceService(session: session).item(provisional) }
            catch { self.error = error.localizedDescription }
        } else if kind == .other { item = WorkspaceItem(id: channel.id, kind: .channel, title: store.title(for: channel)) }
        else { item = provisional }
    }
}
