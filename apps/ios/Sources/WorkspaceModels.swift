import Foundation

enum WorkspaceCollection: String, CaseIterable, Identifiable, Sendable {
    case signal, noise, recent, myFiles, sharedFiles, allFiles, folders, tasks, agents, calls
    var id: String { rawValue }
}

struct WorkspaceListFilter: Equatable, Sendable {
    var unreadOnly = false
    var favoritesOnly = false
    var kind: WorkspaceKind? = nil
    var sortByName = false
    var isEmpty: Bool { !unreadOnly && !favoritesOnly && kind == nil && !sortByName }
}

enum WorkspaceTaskStatus: String, CaseIterable, Identifiable, Sendable {
    case notStarted, inProgress, inReview, completed, canceled
    var id: String { rawValue }
    var title: String {
        switch self {
        case .notStarted: "Not started"
        case .inProgress: "In progress"
        case .inReview: "In review"
        case .completed: "Completed"
        case .canceled: "Canceled"
        }
    }
    var optionID: String {
        let suffix: String
        switch self { case .notStarted: suffix = "1"; case .inProgress: suffix = "2"; case .inReview: suffix = "3"; case .completed: suffix = "4"; case .canceled: suffix = "5" }
        return "00000001-0000-0000-0002-00000000000" + suffix
    }
}

enum WorkspaceKind: String, Codable, CaseIterable, Sendable {
    case document, task, folder, agent, chat, channel, email, call, calendar, reminder, other
    var symbol: String {
        switch self {
        case .document: return "doc.text"
        case .task: return "checkmark.circle"
        case .folder: return "folder"
        case .agent, .chat: return "sparkles"
        case .channel: return "bubble.left.and.bubble.right"
        case .email: return "envelope"
        case .call: return "phone"
        case .calendar: return "calendar"
        case .reminder: return "bell"
        case .other: return "square.grid.2x2"
        }
    }
}

struct WorkspacePage: Sendable {
    var items: [WorkspaceItem]
    var nextCursor: String? = nil
}

/// A stable native projection of the tagged Soup API, preserving its payload for detail views.
struct WorkspaceItem: Identifiable, Sendable, Equatable {
    var id: String
    var kind: WorkspaceKind
    var title: String
    var subtitle: String = ""
    var updatedAt: String = ""
    var ownerID: String? = nil
    var fileType: String? = nil
    var projectID: String? = nil
    var isFavorite = false
    var isUnread = false
    var status: String? = nil
    var channelID: String? = nil
    var photoURL: URL? = nil
    var properties: [WorkspaceProperty] = []
    var entityType: String = "document"
    var payload: WorkspaceJSON = .object([:])
    var date: Date { MessageDate.parse(updatedAt) }
    var preview: String { Self.previewText(subtitle) }
    var summary: String? { payload["summary"].string }
    var isCompleted: Bool {
        if let status, ["Not started", "In progress", "In review", "Completed", "Canceled"].contains(status) {
            return status == "Completed" || status == "Canceled"
        }
        return payload["subType"]["is_completed"].bool == true || payload["completedAt"].string != nil
    }
    var canFavorite: Bool { ["document", "project", "chat", "channel", "email_thread", "agent_session", "call"].contains(entityType) }
    var canRename: Bool { [.document, .task, .folder, .agent, .chat, .call].contains(kind) }

    /// Native projection of the mobile InboxCard hierarchy, keeping API data intact.
    func rowDisplay(currentUserID: String = "", names: [String: String] = [:], channels: [Channel] = []) -> WorkspaceRowDisplay {
        func name(_ id: String) -> String {
            if id == currentUserID { return "You" }
            if let name = names[id], !name.isEmpty { return name }
            if id.hasPrefix("bot|") { return "Agent" }
            return id.replacingOccurrences(of: "macro|", with: "").components(separatedBy: "@").first ?? "Teammate"
        }
        var result = WorkspaceRowDisplay(title: title, preview: preview, icon: iconName, status: displayStatus)
        result.previewFragments = WorkspacePreviewText.fragments(subtitle)
        if kind == .channel {
            let channel = channels.first { $0.id == (channelID ?? id) }
            let participants = channel?.participants.map(\.userID) ?? payload["participants"].array.compactMap { $0.firstString("user_id", "userId") }
            let direct = (channel?.channelType ?? payload.firstString("channel_type", "channelType")) == "direct_message"
            let otherPeople = participants.filter { $0 != currentUserID }
            let channelName = channel?.name.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
                ?? ((title.isEmpty || ["Conversation", "Untitled"].contains(title)) ? nil : title)
            result.title = channelName ?? (direct ? (otherPeople.isEmpty ? "Personal conversation" : otherPeople.map(name).joined(separator: ", ")) : "Unknown channel")
            let message = entityType == "channel_message" ? payload : latestRootMessage
            let senderID = message.firstString("sender_id", "senderId")
            func content(_ message: WorkspaceJSON, fallback: String = "") -> String {
                if message.firstString("deleted_at", "deletedAt") != nil { return "Message deleted" }
                let wire = message["content"].string ?? fallback
                if !Self.previewText(wire).isEmpty { return wire }
                let count = message["attachments"].array.count
                return count > 1 ? "sent \(count) attachments" : count == 1 ? "sent an attachment" : ""
            }
            let wire = content(message, fallback: subtitle)
            var prefix = ""
            if let senderID, !wire.isEmpty, !direct || senderID == currentUserID {
                let sender = message["sender"]["name"].string ?? name(senderID)
                prefix = sender + ": "
            }
            result.previewFragments = WorkspacePreviewText.fragments(wire, prefix: prefix)
            result.preview = result.previewFragments.map(\.text).joined()
            if entityType == "channel_message", let reply = payload["thread"]["preview"].array.max(by: {
                MessageDate.parse($0.firstString("created_at", "createdAt") ?? "") < MessageDate.parse($1.firstString("created_at", "createdAt") ?? "")
            }) {
                result.quote = result.preview
                result.quoteFragments = result.previewFragments
                let sender = reply.firstString("sender_id", "senderId").map(name) ?? "Teammate"
                result.previewFragments = WorkspacePreviewText.fragments(content(reply), prefix: sender + ": ")
                result.preview = result.previewFragments.map(\.text).joined()
            }
            if direct && entityType != "channel_message" {
                result.avatarUserID = otherPeople.first ?? currentUserID
                result.avatarName = result.title; result.photoURL = photoURL
            }
        } else if kind == .email {
            let sender = ["senderName", "sender_name", "senderEmail", "sender_email"].compactMap { payload[$0].string }
                .first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            result.title = sender ?? "Email"
            result.subject = title == "Untitled" || title.isEmpty ? "No subject" : title
        }
        return result
    }

    private var latestRootMessage: WorkspaceJSON {
        if payload["latest_non_thread_message"].object != nil { return payload["latest_non_thread_message"] }
        return payload["latest_message"]
    }
    var iconName: String {
        switch kind {
        case .document: ["spreadsheet", "xlsx", "xls", "csv"].contains(fileType?.lowercased() ?? "") ? "table" : "file"
        case .task: "list-checks"
        case .folder: "folder"
        case .agent, .chat: "sparkle"
        case .channel: entityType == "channel_message" ? "arrow-bend-up-left" : "hash-straight"
        case .email: "envelope"
        case .call: "phone-call"
        case .calendar: "calendar"
        case .reminder: "bell"
        case .other: ["crm_company", "crmCompany"].contains(entityType) ? "building" : "file"
        }
    }
    var displayStatus: String {
        guard kind == .agent else { return status ?? fileType?.uppercased() ?? kind.rawValue.capitalized }
        switch payload.firstString("turnState", "turn_state") ?? status ?? "" {
        case "idle", "acp_ready", "session/end": return "Ready"
        case "starting", "running", "processing": return "Working"
        case "stopping": return "Stopping"
        case "blocked", "awaiting_input": return "Needs input"
        case "disconnected": return "Disconnected"
        default: return "Agent"
        }
    }
    static func previewText(_ text: String) -> String {
        let rendered = MentionCodec.markdownForDisplay(in: text)
        let plain = (try? AttributedString(markdown: rendered, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            .map { String($0.characters) } ?? MentionCodec.displayText(in: text)
        return plain.split(whereSeparator: { $0.isNewline }).joined(separator: " ").trimmingCharacters(in: .whitespaces)
    }

    static func soup(_ raw: WorkspaceJSON) throws -> WorkspaceItem {
        guard let tag = raw["tag"].string else { throw WorkspaceError.invalidResponse }
        var data = raw["data"]
        if tag == "channel", let channel = data["channel"].object {
            // SoupChannel flattens ChannelWithParticipants, whose `channel`
            // metadata remains nested. Recent/Signal mix this shape with files.
            data = .object(channel.merging(data.object ?? [:]) { _, outer in outer })
        }
        guard let id = data.firstString("id", "callId", "threadId", "eventId") else {
            throw WorkspaceError.invalidResponse
        }
        let subtype = data.firstString("subType", "sub_type") ?? data["subType"]["type"].string ?? data["sub_type"]["type"].string
        let kind: WorkspaceKind
        let entityType: String
        switch tag {
        case "document": kind = subtype == "task" ? .task : .document; entityType = "document"
        case "project": kind = .folder; entityType = "project"
        case "agentSession", "agent_session": kind = .agent; entityType = "agent_session"
        case "chat": kind = .chat; entityType = "chat"
        case "channel": kind = .channel; entityType = "channel"
        case "channelThread", "channel_thread": kind = .channel; entityType = "channel_message"
        case "emailThread", "email_thread", "email": kind = .email; entityType = "email_thread"
        case "call", "callRecord": kind = .call; entityType = "call"
        case "calendarEvent", "calendar_event": kind = .calendar; entityType = "calendar_event"
        case "reminder": kind = .reminder; entityType = "reminder"
        default: kind = .other; entityType = tag
        }
        let properties = data["properties"].array.compactMap(WorkspaceProperty.init)
        let latest = data["latest_non_thread_message"].object != nil ? data["latest_non_thread_message"] : data["latest_message"]
        let title = ["name", "subject", "title", "customName", "description", "channelName"].compactMap { data[$0].string }.first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            ?? (kind == .channel ? "Conversation" : kind == .call ? "Call" : "Untitled")
        let summary = data.firstString("snippet", "summary", "content", "repoUrl", "model") ?? latest["content"].string ?? ""
        let updated = raw.firstString("notified_at", "touched_at")
            ?? data.firstString("updatedAt", "updated_at", "startedAt", "createdAt", "created_at", "nextRunAt") ?? ""
        let viewed = data.firstString("viewedAt", "viewed_at")
        let status = properties.first(where: { $0.definitionID == WorkspaceProperty.statusID })?.displayValue
            ?? data.firstString("status", "turnState")
        return WorkspaceItem(id: id, kind: kind, title: title, subtitle: summary, updatedAt: updated,
            ownerID: data.firstString("ownerId", "owner_id", "userId", "createdBy", "sender_id"),
            fileType: data.firstString("fileType", "file_type"), projectID: data.firstString("projectId", "parentId", "project_id"),
            isFavorite: raw["is_favorited"].bool ?? false,
            isUnread: data["isRead"].bool.map { !$0 } ?? data["is_read"].bool.map { !$0 }
                ?? (raw["notified_at"].string.map { MessageDate.parse($0) > MessageDate.parse(viewed ?? "") } ?? false),
            status: status, channelID: data.firstString("channelId", "channel_id"),
            photoURL: data.firstString("avatarUrl", "avatar_url", "photoUrl", "photo_url", "senderPhotoUrl").flatMap(URL.init(string:)),
            properties: properties, entityType: entityType, payload: data)
    }

    static func search(_ raw: WorkspaceJSON) throws -> WorkspaceItem {
        guard let id = raw.firstString("id", "document_id", "channel_id", "thread_id", "call_id") else { throw WorkspaceError.invalidResponse }
        let type = raw["type"].string ?? "document"
        var data = raw.object ?? [:]
        data["id"] = .string(type == "channelMessage" ? raw["message_id"].string ?? id : id)
        data["name"] = .string(raw.firstString("name", "document_name", "channel_name", "subject", "title", "custom_name") ?? "Untitled")
        for key in ["created_at", "updated_at", "viewed_at"] where data[key] == nil { data[key] = raw["metadata"][key] }
        let tag: String
        switch type {
        case "channelMessage": tag = "channelThread"
        case "agent_session": tag = "agentSession"
        case "email": tag = "emailThread"
        case "calendar_event": tag = "calendarEvent"
        default: tag = type
        }
        var item = try soup(.object(["tag": .string(tag), "data": .object(data)]))
        if type == "channelMessage" { item.subtitle = raw["highlight"]["content"].array.compactMap(\.string).joined(separator: " … ") }
        let groups = ["document_search_results", "channel_message_search_results", "email_message_search_results", "chat_message_search_results", "agent_session_search_results", "call_search_results"]
        for group in groups {
            if let result = raw[group].array.first {
                let matches = result["highlight"]["content"].array.compactMap(\.string)
                if item.title == "Untitled", let name = result["highlight"]["name"].array.first?.string {
                    item.title = Self.cleanHighlight(name)
                }
                if !matches.isEmpty { item.subtitle = matches.joined(separator: " … ") }
                else if let snippet = result.firstString("content", "text", "snippet") { item.subtitle = snippet }
                if !item.subtitle.isEmpty { break }
            }
        }
        item.subtitle = Self.cleanHighlight(item.subtitle)
        return item
    }

    private static func cleanHighlight(_ text: String) -> String {
        text.replacingOccurrences(of: "<em>", with: "").replacingOccurrences(of: "</em>", with: "")
    }
}

struct WorkspaceRowDisplay: Equatable, Sendable {
    var title: String
    var subject: String? = nil
    var quote: String? = nil
    var preview: String
    var icon: String
    var status: String
    var previewFragments: [WorkspacePreviewText.Fragment] = []
    var quoteFragments: [WorkspacePreviewText.Fragment] = []
    var avatarUserID: String? = nil
    var avatarName: String? = nil
    var photoURL: URL? = nil
}

struct WorkspaceProperty: Identifiable, Sendable, Equatable {
    static let statusID = "00000001-0000-0000-0000-000000000002"
    static let assigneesID = "00000001-0000-0000-0000-000000000001"
    static let completedID = "00000001-0000-0000-0002-000000000004"
    static let notStartedID = "00000001-0000-0000-0002-000000000001"
    var id: String
    var definitionID: String
    var name: String
    var value: WorkspaceJSON
    var optionNames: [String: String] = [:]
    var displayValue: String {
        let values = value["value"].array
        let names = values.compactMap { element -> String? in
            guard let id = element.string else { return element.firstString("name", "entity_name", "entityName", "entity_id", "entityId") }
            if let label = optionNames[id] { return label }
            if definitionID == Self.statusID {
                return [Self.notStartedID: "Not started", "00000001-0000-0000-0002-000000000002": "In progress",
                    "00000001-0000-0000-0002-000000000003": "In review", Self.completedID: "Completed",
                    "00000001-0000-0000-0002-000000000005": "Canceled"][id] ?? id
            }
            if definitionID == "00000001-0000-0000-0000-000000000003" {
                return ["00000001-0000-0000-0003-000000000001": "Low", "00000001-0000-0000-0003-000000000002": "Medium",
                    "00000001-0000-0000-0003-000000000003": "High", "00000001-0000-0000-0003-000000000004": "Urgent"][id] ?? id
            }
            return id
        }
        if !names.isEmpty { return names.joined(separator: ", ") }
        return value["value"].string ?? value["value"].number.map { String($0) } ?? value["value"].bool.map { $0 ? "Yes" : "No" } ?? ""
    }
    init?(_ raw: WorkspaceJSON) {
        guard let id = raw["id"].string ?? raw["property"]["id"].string,
            let definitionID = raw["definition"]["id"].string else { return nil }
        self.id = id; self.definitionID = definitionID
        name = raw["definition"].firstString("display_name", "displayName") ?? "Property"
        value = raw["value"]
        for option in raw["options"].array {
            guard let optionID = option["id"].string else { continue }
            let value = option["value"]["value"]
            optionNames[optionID] = value.string ?? value.number.map { $0.formatted(.number.grouping(.never)) }
        }
    }
}

struct WorkspaceNotificationPage: Decodable, Sendable {
    var items: [WorkspaceNotification]
    var nextCursor: String?
    enum CodingKeys: String, CodingKey { case items; case nextCursor = "next_cursor" }
}

struct WorkspaceNotification: Decodable, Identifiable, Sendable {
    var id: String
    var entityID: String
    var entityType: String
    var eventType: String
    var senderID: String?
    var createdAt: String
    var state: String
    var metadata: WorkspaceJSON
    var isUnread: Bool { state == "unseen" }
    var title: String { metadata.firstString("title", "document_name", "channel_name", "name") ?? eventType.replacingOccurrences(of: "_", with: " ").capitalized }
    var body: String { metadata.firstString("content", "message", "text", "description") ?? "" }
    enum CodingKeys: String, CodingKey {
        case id, state; case entityID = "entity_id", entityType = "entity_type", eventType = "notification_event_type"
        case senderID = "sender_id", createdAt = "created_at", metadata = "notification_metadata"
    }
}

struct WorkspaceCallRecord: Decodable, Identifiable, Sendable {
    var callId: String
    var channelId: String
    var channelName: String?
    var customName: String?
    var createdBy: String
    var startedAt: String
    var endedAt: String?
    var durationMs: Int?
    var isActive: Bool
    var summary: String?
    var recordingUrl: URL?
    var recordingPreviewUrl: URL?
    var participants: [WorkspaceCallParticipant]
    var transcript: [WorkspaceTranscriptSegment]
    var id: String { callId }
    var title: String { customName ?? channelName ?? "Call" }
}
struct WorkspaceCallParticipant: Decodable, Sendable { var userId: String; var joinedAt: String; var leftAt: String? }
struct WorkspaceTranscriptSegment: Decodable, Identifiable, Sendable {
    var transcriptId: String; var speakerId: String; var content: String; var startedAt: String; var endedAt: String?; var sequenceNum: Int
    var id: String { transcriptId }
}
struct WorkspaceActiveCall: Decodable, Identifiable, Sendable {
    var callId: String; var channelId: String; var createdAt: String; var createdBy: String; var participantCount: Int
    var id: String { callId }
}

enum WorkspaceError: LocalizedError {
    case invalidResponse, unsupportedAction, searchTooShort, invalidName
    case server(String)
    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Macro returned an unexpected workspace response."
        case .unsupportedAction: return "This action is not available for this item."
        case .searchTooShort: return "Type at least 3 characters to search."
        case .invalidName: return "Enter a name."
        case .server(let message): return message
        }
    }
}

/// JSON values remain local to the workspace adapter; arbitrary entity metadata never breaks a feed.
enum WorkspaceJSON: Codable, Sendable, Equatable {
    case object([String: WorkspaceJSON]), array([WorkspaceJSON]), string(String), number(Double), bool(Bool), null
    var object: [String: WorkspaceJSON]? { if case .object(let value) = self { return value }; return nil }
    var array: [WorkspaceJSON] { if case .array(let value) = self { return value }; return [] }
    var string: String? { if case .string(let value) = self { return value }; return nil }
    var bool: Bool? { if case .bool(let value) = self { return value }; return nil }
    var number: Double? { if case .number(let value) = self { return value }; return nil }
    subscript(_ key: String) -> WorkspaceJSON { object?[key] ?? .null }
    func firstString(_ keys: String...) -> String? { keys.lazy.compactMap { self[$0].string }.first(where: { !$0.isEmpty }) }
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let object = try? value.decode([String: WorkspaceJSON].self) { self = .object(object) }
        else if let array = try? value.decode([WorkspaceJSON].self) { self = .array(array) }
        else if let bool = try? value.decode(Bool.self) { self = .bool(bool) }
        else if let string = try? value.decode(String.self) { self = .string(string) }
        else { self = .number(try value.decode(Double.self)) }
    }
    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .object(let object): try value.encode(object)
        case .array(let array): try value.encode(array)
        case .string(let string): try value.encode(string)
        case .number(let number): try value.encode(number)
        case .bool(let bool): try value.encode(bool)
        case .null: try value.encodeNil()
        }
    }
}
