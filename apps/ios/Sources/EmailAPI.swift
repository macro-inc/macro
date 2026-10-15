import Foundation

@MainActor
protocol EmailService {
    func inboxes() async throws -> [EmailInbox]
    func page(_ query: EmailQuery, cursor: String?) async throws -> EmailPage
    func thread(_ id: String, offset: Int) async throws -> EmailThread
    func labels() async throws -> [EmailLabel]
    func seen(_ id: String, inboxID: String) async throws
    func archive(_ id: String, inboxID: String, value: Bool) async throws
    func label(_ id: String, inboxID: String, labelID: String, value: Bool) async throws
    func save(_ input: EmailDraftInput, inboxID: String) async throws -> EmailDraftResult
    func send(_ input: EmailDraftInput, inboxID: String) async throws
    func unschedule(_ draftID: String, inboxID: String) async throws
    func schedule(_ draftID: String, inboxID: String, sendTime: Date, includeSignature: Bool?) async throws
    func forwardAttachment(_ id: String, draftID: String, inboxID: String) async throws
    func createAttachment(_ attachment: EmailLocalAttachment, draftID: String, inboxID: String) async throws -> EmailUploadTicket
    func uploadAttachment(_ attachment: EmailLocalAttachment, ticket: EmailUploadTicket) async throws
    func removeAttachment(_ id: String, draftID: String, inboxID: String, forwarded: Bool) async throws
    func attachmentURL(_ id: String) async throws -> URL
}

@MainActor
final class EmailAPI: EmailService {
    typealias Transport = @MainActor (URLRequest) async throws -> Data
    private let baseURL: URL
    private let transport: Transport
    static let pageSize = 50
    static let messagePageSize = 20
    static let nilID = "00000000-0000-0000-0000-000000000000"

    init(baseURL: URL, transport: @escaping Transport) { self.baseURL = baseURL; self.transport = transport }
    convenience init(session: NativeSession) {
        self.init(baseURL: session.environment.gatewayURL, transport: { try await session.authenticatedData(for: $0) })
    }
    func inboxes() async throws -> [EmailInbox] {
        struct Response: Decodable { var links: [EmailInbox] }
        return try await decode(Response.self, path: "email/email/links").links
    }
    func labels() async throws -> [EmailLabel] {
        struct Response: Decodable { var labels: [EmailLabel] }
        return try await decode(Response.self, path: "email/email/labels").labels
    }
    func thread(_ id: String, offset: Int = 0) async throws -> EmailThread {
        struct Response: Decodable { var thread: EmailThread }
        return try await decode(Response.self, path: "email/email/threads/\(id)", query: [URLQueryItem(name: "offset", value: String(offset)), URLQueryItem(name: "limit", value: String(Self.messagePageSize))]).thread
    }
    func page(_ query: EmailQuery, cursor: String?) async throws -> EmailPage {
        if query.tab == .scheduled { return try await scheduledPage(query) }
        let params = cursor.map { [URLQueryItem(name: "cursor", value: $0)] } ?? []
        if query.isSearch {
            let data = try await request(path: "dss/search", method: "POST", query: params + [URLQueryItem(name: "page_size", value: String(Self.pageSize))], body: Self.searchBody(query))
            return try Self.searchPage(data)
        }
        let data = try await request(path: "dss/items/soup/ast", method: "POST", query: params, body: Self.listBody(query))
        var page = try Self.soupPage(data)
        if !query.attachmentKinds.isEmpty { page.items.removeAll { $0.attachmentKinds.isDisjoint(with: query.attachmentKinds) } }
        return page
    }

    private func scheduledPage(_ query: EmailQuery) async throws -> EmailPage {
        struct Response: Decodable { var messages: [EmailMessage] }
        let ids: [String]
        if let id = query.inboxID { ids = [id] } else { ids = try await inboxes().map(\.id) }
        var messages: [EmailMessage] = []
        for id in ids {
            var offset = 0
            while true {
                try Task.checkCancellation()
                let data = try await request(path: "email/email/drafts/scheduled", query: [URLQueryItem(name: "offset", value: String(offset)), URLQueryItem(name: "limit", value: "100")], inboxID: id)
                let page = try JSONDecoder().decode(Response.self, from: data).messages
                messages += page
                if page.count < 100 { break }
                offset += page.count
            }
        }
        var idsSeen = Set<String>()
        let items = messages.filter { $0.is_draft && !$0.is_sent && $0.scheduled_send_time != nil }
            .sorted { MessageDate.parse($0.scheduled_send_time!) < MessageDate.parse($1.scheduled_send_time!) }
            .filter { idsSeen.insert($0.thread_db_id).inserted }.map { message in
                EmailPreview(id: message.thread_db_id, linkID: message.link_id, subject: Self.subject(message.subject),
                    sender: message.to.map(\.displayName).joined(separator: ", "), senderEmail: message.to.first?.email ?? "", snippet: message.snippet ?? "",
                    date: MessageDate.parse(message.scheduled_send_time!), isRead: true, isDraft: true, isStarred: false, isSignal: false,
                    inboxVisible: false, hasAttachments: !message.attachments.isEmpty, participants: message.to, scheduledAt: MessageDate.parse(message.scheduled_send_time!))
            }
        return EmailPage(items: items, cursor: nil)
    }
    func seen(_ id: String, inboxID: String) async throws {
        _ = try await request(path: "email/email/threads/\(id)/seen", method: "POST", inboxID: inboxID)
    }
    func archive(_ id: String, inboxID: String, value: Bool) async throws {
        _ = try await request(path: "email/email/threads/\(id)/archived", method: "PATCH", body: ["value": value], inboxID: inboxID)
    }
    func label(_ id: String, inboxID: String, labelID: String, value: Bool) async throws {
        _ = try await request(path: "email/email/threads/\(id)/labels", method: "PATCH", body: ["label_id": labelID, "value": value], inboxID: inboxID)
    }
    func save(_ input: EmailDraftInput, inboxID: String) async throws -> EmailDraftResult {
        struct Body: Encodable { var draft: EmailDraftInput }
        struct Response: Decodable { var draft: EmailDraftResult }
        let data = try await request(path: "email/email/drafts", method: "POST", encodedBody: JSONEncoder().encode(Body(draft: input)), inboxID: inboxID)
        return try JSONDecoder().decode(Response.self, from: data).draft
    }
    func send(_ input: EmailDraftInput, inboxID: String) async throws {
        struct Body: Encodable { var message: EmailDraftInput }
        _ = try await request(path: "email/email/messages", method: "POST", encodedBody: JSONEncoder().encode(Body(message: input)), inboxID: inboxID)
    }
    func unschedule(_ draftID: String, inboxID: String) async throws {
        _ = try await request(path: "email/email/drafts/scheduled/\(draftID)", method: "DELETE", inboxID: inboxID)
    }
    func schedule(_ draftID: String, inboxID: String, sendTime: Date, includeSignature: Bool?) async throws {
        var body: [String: Any] = ["send_time": ISO8601DateFormatter().string(from: sendTime)]
        if let includeSignature { body["include_signature"] = includeSignature }
        _ = try await request(path: "email/email/drafts/scheduled/\(draftID)", method: "PUT", body: body, inboxID: inboxID)
    }
    func forwardAttachment(_ id: String, draftID: String, inboxID: String) async throws {
        _ = try await request(path: "email/email/drafts/\(draftID)/forwarded-attachments", method: "POST", body: ["attachment_id": id], inboxID: inboxID)
    }

    func createAttachment(_ attachment: EmailLocalAttachment, draftID: String, inboxID: String) async throws -> EmailUploadTicket {
        let data = try await request(path: "email/email/drafts/\(draftID)/attachments", method: "POST", body: ["file_name": attachment.name, "sha": attachment.sha, "size": attachment.size], inboxID: inboxID)
        return try JSONDecoder().decode(EmailUploadTicket.self, from: data)
    }
    func uploadAttachment(_ attachment: EmailLocalAttachment, ticket: EmailUploadTicket) async throws {
        let request = try Self.uploadRequest(attachment, ticket: ticket)
        // Presigned storage requests never receive Macro credentials or cookies.
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }
        let (_, response) = try await session.upload(for: request, fromFile: attachment.localURL)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { throw EmailAttachmentError.uploadFailed }
    }
    static func uploadRequest(_ attachment: EmailLocalAttachment, ticket: EmailUploadTicket) throws -> URLRequest {
        guard let url = URL(string: ticket.upload_url), url.scheme == "https" else { throw EmailAttachmentError.invalidURL }
        var request = URLRequest(url: url, timeoutInterval: 120)
        request.httpMethod = "PUT"
        request.setValue(ticket.content_type, forHTTPHeaderField: "Content-Type")
        request.setValue(attachment.checksum, forHTTPHeaderField: "x-amz-checksum-sha256")
        return request
    }
    func removeAttachment(_ id: String, draftID: String, inboxID: String, forwarded: Bool) async throws {
        let kind = forwarded ? "forwarded-attachments" : "attachments"
        _ = try await request(path: "email/email/drafts/\(draftID)/\(kind)/\(id)", method: "DELETE", inboxID: inboxID)
    }
    func attachmentURL(_ id: String) async throws -> URL {
        struct Response: Decodable { var attachment: EmailAttachment }
        let result = try await decode(Response.self, path: "email/email/attachments/\(id)")
        guard let raw = result.attachment.data_url, let url = URL(string: raw), url.scheme == "https" else { throw EmailAttachmentError.invalidURL }
        return url
    }

    // The AST's Importance is Macro Signal, not Gmail's IMPORTANT label. All filters run before pagination.
    static func listBody(_ query: EmailQuery) -> [String: Any] {
        func literal(_ key: String, _ value: Any) -> [String: Any] { ["l": [key: value]] }
        var body: [String: Any] = ["expand": true, "limit": pageSize, "sort_method": "updated_at", "sort_direction": "desc", "emailView": query.tab.mailbox]
        let blocked = ["df": "id", "cf": "cid", "pf": "pid", "chanf": "ChannelId", "cthf": "ThreadId", "callf": "CallId", "calf": "id", "ccf": "id", "fef": "id", "asf": "id", "remf": "id"]
        for (key, idKey) in blocked { body[key] = literal(idKey, nilID) }
        var expressions: [[String: Any]] = []
        if let importance = query.tab.importance {
            expressions += [literal("Importance", importance), literal("Shared", "exclude")]
        }
        if query.tab == .shared { expressions.append(literal("Shared", "only")) }
        if query.tab == .calendar { expressions.append(literal("Shared", "exclude")) }
        if query.tab == .calendar || query.calendarOnly { expressions.append(literal("CalendarOnly", true)) }
        if let inboxID = query.inboxID { expressions.append(literal("Owner", inboxID)) }
        if query.unreadOnly { expressions.append(literal("Read", false)) }
        else if query.readOnly { expressions.append(literal("Read", true)) }
        if let done = query.done { expressions.append(literal("InboxVisible", !done)) }
        body["ef"] = expressions.reduce(["!": literal("ThreadId", nilID)]) { ["&": [$0, $1]] }
        return body
    }
    static func searchBody(_ query: EmailQuery) -> [String: Any] {
        var email: [String: Any] = ["shared": "exclude"]
        if let importance = query.tab.importance { email["importance"] = importance }
        if let inbox = query.inboxID { email["link_ids"] = [inbox] }
        if query.unreadOnly { email["is_read"] = false }
        else if query.readOnly { email["is_read"] = true }
        if query.tab == .shared { email["shared"] = "only" }
        if query.tab == .calendar || query.calendarOnly { email["calendar_only"] = true }
        if let done = query.done { email[done ? "exclude_labels" : "include_labels"] = ["INBOX"] }
        var filters: [String: Any] = ["email_filters": email]
        for (key, idKey) in ["calendar_event_filters": "calendar_event_ids", "call_filters": "call_ids", "channel_filters": "channel_ids", "channel_thread_filters": "thread_ids", "chat_filters": "chat_ids", "crm_company_filters": "company_ids", "document_filters": "document_ids", "foreign_entity_filters": "ids", "project_filters": "project_ids", "reminder_filters": "ids", "agent_session_filters": "ids"] {
            filters[key] = [idKey: [nilID]]
        }
        return ["query": query.text.trimmingCharacters(in: .whitespacesAndNewlines), "match_type": "partial", "search_on": "name_content", "filters": filters]
    }
    static func soupPage(_ data: Data) throws -> EmailPage {
        guard let response = try JSONSerialization.jsonObject(with: data) as? [String: Any], let items = response["items"] as? [[String: Any]] else { throw EmailError.invalidResponse }
        let previews = try items.filter { ($0["tag"] as? String) == "emailThread" }.map { item -> EmailPreview in
            guard let row = item["data"] as? [String: Any], let id = row["id"] as? String else { throw EmailError.invalidResponse }
            let labels = row["labels"] as? [[String: Any]] ?? []
            let participants = row["participants"] as? [[String: Any]] ?? []
            let links = Set((labels + participants).compactMap { $0["linkId"] as? String })
            return EmailPreview(id: id, linkID: row["linkId"] as? String ?? (links.count == 1 ? links.first : nil),
                subject: subject(row["name"] as? String), sender: row["senderName"] as? String ?? row["senderEmail"] as? String ?? "Unknown sender",
                senderEmail: row["senderEmail"] as? String ?? "", snippet: row["snippet"] as? String ?? "",
                date: MessageDate.parse(row["sortTs"] as? String ?? row["updatedAt"] as? String ?? ""),
                isRead: row["isRead"] as? Bool ?? false, isDraft: row["isDraft"] as? Bool ?? false,
                isStarred: labels.contains { $0["providerLabelId"] as? String == "STARRED" },
                isSignal: row["isSignal"] as? Bool ?? false, inboxVisible: row["inboxVisible"] as? Bool ?? false,
                hasAttachments: !(row["attachments"] as? [Any] ?? []).isEmpty,
                participants: participants.compactMap { value in
                    guard let email = value["emailAddress"] as? String, !email.isEmpty else { return nil }
                    return EmailContact(email: email, name: value["name"] as? String)
                }, isCalendarInvite: (row["attachments"] as? [[String: Any]] ?? []).contains {
                    ($0["filename"] as? String)?.lowercased().hasSuffix(".ics") == true || ($0["mimeType"] as? String)?.lowercased() == "text/calendar"
                }, attachmentKinds: Set((row["attachments"] as? [[String: Any]] ?? []).compactMap {
                    EmailAttachmentKind.classify(mime: $0["mimeType"] as? String ?? "", name: $0["filename"] as? String ?? "")
                }))
        }
        return EmailPage(items: previews, cursor: response["next_cursor"] as? String)
    }
    static func searchPage(_ data: Data) throws -> EmailPage {
        guard let response = try JSONSerialization.jsonObject(with: data) as? [String: Any], let items = response["results"] as? [[String: Any]] else { throw EmailError.invalidResponse }
        let previews = try items.filter { $0["type"] as? String == "email" }.map { row -> EmailPreview in
            guard let id = row["thread_id"] as? String ?? row["id"] as? String else { throw EmailError.invalidResponse }
            let message = (row["email_message_search_results"] as? [[String: Any]])?.first ?? [:]
            return EmailPreview(id: id, linkID: row["link_id"] as? String, subject: subject(row["name"] as? String ?? row["subject"] as? String),
                sender: message["pretty_sender"] as? String ?? message["sender"] as? String ?? "Email",
                senderEmail: message["sender"] as? String ?? "", snippet: row["snippet"] as? String ?? "",
                date: MessageDate.parse(row["updated_at"] as? String ?? ""), isRead: row["is_read"] as? Bool ?? false,
                isDraft: row["is_draft"] as? Bool ?? false, isStarred: (message["labels"] as? [String] ?? []).contains("STARRED"),
                isSignal: false, inboxVisible: row["inbox_visible"] as? Bool ?? false, hasAttachments: false)
        }
        return EmailPage(items: previews, cursor: response["next_cursor"] as? String)
    }
    private static func subject(_ value: String?) -> String { value.flatMap { $0.isEmpty ? nil : $0 } ?? "(No subject)" }
    private func decode<T: Decodable>(_ type: T.Type, path: String, query: [URLQueryItem] = []) async throws -> T {
        try JSONDecoder().decode(type, from: await request(path: path, query: query))
    }
    private func request(path: String, method: String = "GET", query: [URLQueryItem] = [], body: [String: Any]? = nil, encodedBody: Data? = nil, inboxID: String? = nil) async throws -> Data {
        var url = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { url.queryItems = query }
        guard let address = url.url else { throw EmailError.invalidResponse }
        var request = URLRequest(url: address, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = method
        request.httpBody = try encodedBody ?? body.map { try JSONSerialization.data(withJSONObject: $0) }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if request.httpBody != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let inboxID { request.setValue(inboxID, forHTTPHeaderField: "X-Email-Link-Id") }
        return try await transport(request)
    }
}
