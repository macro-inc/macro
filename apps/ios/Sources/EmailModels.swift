import Foundation

struct EmailInbox: Decodable, Identifiable, Equatable {
    var id: String
    var email_address: String
    var is_primary: Bool
    var needs_reauth: Bool
    var is_sync_active: Bool?
    var settings: EmailInboxSettings? = nil
}

struct EmailInboxSettings: Decodable, Equatable {
    var signature: String?
    var signature_on_replies_forwards: Bool?
}

struct EmailContact: Codable, Equatable {
    var email: String
    var name: String? = nil
    var displayName: String { name.flatMap { $0.isEmpty ? nil : $0 } ?? email }
}

struct EmailLabel: Decodable, Equatable {
    var id: String
    var linkId: String
    var providerLabelId: String
    var name: String
}

struct EmailPreview: Identifiable, Equatable {
    var id: String
    var linkID: String?
    var subject: String
    var sender: String
    var senderEmail: String
    var snippet: String
    var date: Date
    var isRead: Bool
    var isDraft: Bool
    var isStarred: Bool
    var isSignal: Bool
    var inboxVisible: Bool
    var hasAttachments: Bool
    var participants: [EmailContact] = []
    var isCalendarInvite = false
    var attachmentKinds: Set<EmailAttachmentKind> = []
    var scheduledAt: Date? = nil

    func senderLabel(excluding addresses: Set<String>) -> String {
        var seen = Set<String>()
        let people = participants.filter { !addresses.contains($0.email.lowercased()) && seen.insert($0.email.lowercased()).inserted }
        if people.count == 1 { return people[0].displayName }
        if people.count > 1 {
            return people.prefix(3).map { person in
                if let name = person.name, !name.isEmpty { return String(name.split(separator: " ").first ?? Substring(name)) }
                return person.email
            }.joined(separator: ", ")
        }
        return sender.isEmpty ? senderEmail : sender
    }
}

enum EmailDateGrouping {
    static func title(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        let today = calendar.startOfDay(for: now)
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: today).day ?? 0
        if days <= 0 { return "Today" }
        if days == 1 { return "Yesterday" }
        if days < 7 { return "Last 7 days" }
        if calendar.isDate(date, equalTo: now, toGranularity: .month) { return "Earlier this month" }
        if let previousMonth = calendar.date(byAdding: .month, value: -1, to: now), calendar.isDate(date, equalTo: previousMonth, toGranularity: .month) { return "Last month" }
        return "Older"
    }
}

struct EmailPage {
    var items: [EmailPreview]
    var cursor: String?
}

enum EmailTab: String, CaseIterable, Identifiable {
    case signal = "Signal", noise = "Noise", sent = "Sent", scheduled = "Scheduled", calendar = "Calendar", drafts = "Drafts", shared = "Shared", all = "All"
    var id: String { rawValue }
    var mailbox: String {
        switch self { case .signal, .noise: "inbox"; case .all, .calendar, .shared: "all"; case .sent: "sent"; case .drafts, .scheduled: "drafts" }
    }
    var importance: Bool? {
        switch self { case .signal: true; case .noise: false; default: nil }
    }
}

struct EmailQuery: Hashable {
    var tab: EmailTab = .signal
    var inboxID: String?
    var unreadOnly = false
    var readOnly = false
    var done: Bool? = nil
    var calendarOnly = false
    var attachmentKinds: Set<EmailAttachmentKind> = []
    var text = ""
    var isSearch: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3 }
}

enum EmailAttachmentKind: String, CaseIterable, Hashable {
    case pdf = "PDFs", image = "Images", document = "Documents"
    static func classify(mime: String, name: String) -> Self? {
        let mime = mime.lowercased(), name = name.lowercased()
        if mime == "application/pdf" || name.hasSuffix(".pdf") { return .pdf }
        if mime.hasPrefix("image/") { return .image }
        if mime.hasPrefix("text/") && !mime.contains("calendar") || mime.contains("word") || mime.contains("spreadsheet") || mime.contains("presentation") || [".doc", ".docx", ".xlsx", ".csv", ".md", ".txt"].contains(where: name.hasSuffix) { return .document }
        return nil
    }
}

struct EmailAttachment: Decodable, Identifiable, Equatable {
    var db_id: String
    var filename: String?
    var mime_type: String?
    var size_bytes: Int?
    var data_url: String? = nil
    var id: String { db_id }
}

struct EmailMessage: Decodable, Identifiable, Equatable {
    var db_id: String
    var thread_db_id: String
    var link_id: String
    var from: EmailContact?
    var to: [EmailContact]
    var cc: [EmailContact]
    var bcc: [EmailContact]
    var subject: String?
    var snippet: String?
    var body_text: String?
    var body_html_sanitized: String?
    var is_draft: Bool
    var is_read: Bool
    var is_sent: Bool
    var is_starred: Bool
    var created_at: String
    var sent_at: String?
    var provider_id: String?
    var provider_thread_id: String?
    var replying_to_id: String?
    var attachments: [EmailAttachment]
    var attachments_draft: [EmailDraftAttachment]? = nil
    var attachments_forwarded: [EmailForwardedAttachment]? = nil
    var scheduled_send_time: String? = nil
    var body_macro: String? = nil
    var id: String { db_id }
    var date: Date { MessageDate.parse(sent_at ?? created_at) }
    var text: String {
        if let plain = body_text?.trimmingCharacters(in: .whitespacesAndNewlines), !plain.isEmpty { return plain }
        return body_html_sanitized.map(EmailPlainText.fromHTML) ?? ""
    }
}

struct EmailThread: Decodable, Identifiable, Equatable {
    var db_id: String
    var link_id: String
    var inbox_visible: Bool
    var is_read: Bool
    var messages: [EmailMessage]
    var provider_id: String?
    var id: String { db_id }
    var subject: String { messages.first?.subject.flatMap { $0.isEmpty ? nil : $0 } ?? "(No subject)" }
    var isStarred: Bool { messages.contains(where: \.is_starred) }
    var lastMessage: EmailMessage? { messages.filter { !$0.is_draft }.max { $0.date < $1.date } }
}

/// These wire keys deliberately match ApiDraftInput. Plain text is a supported server body format.
struct EmailDraftInput: Codable, Equatable {
    var subject: String
    var to: [EmailContact]
    var cc: [EmailContact]
    var bcc: [EmailContact]
    var body_text: String
    var db_id: String?
    var thread_db_id: String?
    var provider_id: String?
    var provider_thread_id: String?
    var replying_to_id: String?
    var include_signature: Bool? = nil
    var body_html: String? = nil
    var body_macro: String? = nil
}

struct EmailDraftResult: Decodable {
    var db_id: String?
    var thread_db_id: String?
    var provider_id: String?
    var provider_thread_id: String?
}

struct EmailComposition: Identifiable, Equatable {
    var id = UUID()
    var inboxID: String
    var to = ""
    var cc = ""
    var bcc = ""
    var subject = ""
    var body = ""
    var draftID: String?
    var threadID: String?
    var providerID: String?
    var providerThreadID: String?
    var replyingToID: String?
    var forwardedAttachments: [EmailAttachment] = []
    var attachedForwardIDs: Set<String> = []
    var localAttachments: [EmailLocalAttachment] = []
    var existingAttachments: [EmailDraftAttachment] = []
    var existingForwards: [EmailForwardedAttachment] = []
    var removedAttachments: Set<String> = []
    var removedForwards: Set<String> = []
    var webURL = URL(string: "https://macro.com/app")!
    var includeSignature: Bool? = nil
    var sendTime: Date? = nil
    var scheduledAt: Date? = nil
    var title = "New email"
    var isEmpty: Bool { to.isEmpty && cc.isEmpty && bcc.isEmpty && subject.isEmpty && body.isEmpty && localAttachments.isEmpty && forwardedAttachments.isEmpty && existingAttachments.isEmpty && existingForwards.isEmpty }

    func input(requireRecipients: Bool) throws -> EmailDraftInput {
        let recipients = try EmailRecipients.parse(to)
        let copy = try EmailRecipients.parse(cc)
        let blind = try EmailRecipients.parse(bcc)
        if requireRecipients && recipients.isEmpty && copy.isEmpty && blind.isEmpty { throw EmailError.noRecipients }
        let prepared = EmailRichBody.prepare(body, webURL: webURL)
        return EmailDraftInput(subject: subject, to: recipients, cc: copy, bcc: blind, body_text: prepared.text,
                               db_id: draftID, thread_db_id: threadID, provider_id: providerID,
                               provider_thread_id: providerThreadID, replying_to_id: replyingToID, include_signature: includeSignature, body_html: prepared.encodedHTML, body_macro: body)
    }

    mutating func apply(_ draft: EmailDraftResult) {
        draftID = draft.db_id ?? draftID
        threadID = draft.thread_db_id ?? threadID
        providerID = draft.provider_id ?? providerID
        providerThreadID = draft.provider_thread_id ?? providerThreadID
    }

    static func reply(to message: EmailMessage, inbox: EmailInbox, all: Bool) -> EmailComposition {
        let own = inbox.email_address.lowercased()
        let sender = message.from.map { [$0] } ?? []
        let primary = sender.filter { $0.email.lowercased() != own }
        var result = EmailComposition(inboxID: inbox.id)
        let to = primary.isEmpty ? message.to.filter { $0.email.lowercased() != own } : primary
        result.to = EmailRecipients.unique(to).map(\.email).joined(separator: ", ")
        if all {
            let excluded = Set(to.map { $0.email.lowercased() }).union([own])
            result.cc = EmailRecipients.unique(message.to + message.cc).filter { !excluded.contains($0.email.lowercased()) }.map(\.email).joined(separator: ", ")
        }
        result.subject = prefixed(message.subject ?? "", prefix: "Re:")
        result.threadID = message.thread_db_id
        result.providerThreadID = message.provider_thread_id
        result.replyingToID = message.id
        result.title = all ? "Reply all" : "Reply"
        return result
    }

    static func forward(_ message: EmailMessage, inboxID: String) -> EmailComposition {
        var result = EmailComposition(inboxID: inboxID)
        result.subject = prefixed(message.subject ?? "", prefix: "Fwd:")
        result.body = "\n\n---------- Forwarded message ----------\nFrom: \(message.from?.displayName ?? "Unknown") <\(message.from?.email ?? "")>\nDate: \(message.date.formatted(date: .abbreviated, time: .shortened))\nSubject: \(message.subject ?? "")\nTo: \(message.to.map(\.email).joined(separator: ", "))\n\n\(message.text)"
        result.forwardedAttachments = message.attachments
        result.title = "Forward"
        return result
    }

    static func editing(_ message: EmailMessage) -> EmailComposition {
        var result = EmailComposition(inboxID: message.link_id)
        result.to = message.to.map(\.email).joined(separator: ", ")
        result.cc = message.cc.map(\.email).joined(separator: ", ")
        result.bcc = message.bcc.map(\.email).joined(separator: ", ")
        result.subject = message.subject ?? ""
        result.body = message.body_macro ?? message.text
        result.draftID = message.id
        result.threadID = message.thread_db_id
        result.providerID = message.provider_id
        result.providerThreadID = message.provider_thread_id
        result.replyingToID = message.replying_to_id
        result.existingAttachments = message.attachments_draft ?? []
        result.existingForwards = message.attachments_forwarded ?? []
        result.scheduledAt = message.scheduled_send_time.map(MessageDate.parse)
        result.sendTime = result.scheduledAt
        result.title = "Draft"
        return result
    }

    private static func prefixed(_ value: String, prefix: String) -> String {
        value.lowercased().hasPrefix(prefix.lowercased()) ? value : "\(prefix) \(value)"
    }
}

enum EmailRecipientSummary {
    static func label(_ recipients: [EmailContact]) -> String {
        let names = recipients.prefix(2).map(\.displayName).joined(separator: ", ")
        let extra = recipients.count - 2
        return extra > 0 ? names + " & \(extra) more…" : names
    }
}

enum EmailRecipients {
    static func parse(_ text: String) throws -> [EmailContact] {
        let parts = text.components(separatedBy: CharacterSet(charactersIn: ",;\n")).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        return try unique(parts.map { part in
            let address: String
            var name: String?
            if let start = part.lastIndex(of: "<"), part.last == ">" {
                address = String(part[part.index(after: start)..<part.index(before: part.endIndex)]).trimmingCharacters(in: .whitespaces)
                name = String(part[..<start]).trimmingCharacters(in: CharacterSet(charactersIn: " \""))
            } else { address = part }
            guard address.range(of: #"^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$"#, options: .regularExpression) != nil else {
                throw EmailError.invalidRecipient(part)
            }
            return EmailContact(email: address, name: name?.isEmpty == false ? name : nil)
        })
    }
    static func unique(_ contacts: [EmailContact]) -> [EmailContact] {
        var seen: Set<String> = []
        return contacts.filter { seen.insert($0.email.lowercased()).inserted }
    }
}

enum EmailError: LocalizedError {
    case invalidResponse, noInbox, noRecipients, invalidRecipient(String), missingLabel, missingDraft, invalidSchedule, scheduledDraftLocked
    var errorDescription: String? {
        switch self {
        case .invalidResponse: "Email returned an unexpected response. Please try again."
        case .noInbox: "Connect an email account in Macro to use email."
        case .noRecipients: "Add a recipient before sending."
        case .invalidRecipient(let address): "Check this email address: \(address)"
        case .missingLabel: "This mailbox doesn't support that label yet. Refresh and try again."
        case .scheduledDraftLocked: "Cancel the scheduled send before editing this email."
        case .invalidSchedule: "Choose a time in the future."
        case .missingDraft: "The draft could not be saved. Please try again."
        }
    }
}

/// A readable plain-text fallback for HTML-only mail, without loading remote resources.
/// The full server-sanitized formatting remains available in the body viewer.
enum EmailPlainText {
    static func fromHTML(_ html: String) -> String {
        var value = html.replacingOccurrences(of: #"(?is)<(script|style)\b[^>]*>.*?</\1\s*>"#, with: "", options: .regularExpression)
        value = value.replacingOccurrences(of: #"(?i)<br\s*/?>|</(?:p|div|tr|h[1-6]|li)\s*>"#, with: "\n", options: .regularExpression)
        value = value.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
        let numeric = try! NSRegularExpression(pattern: #"&#(x[0-9a-fA-F]+|[0-9]+);"#)
        let source = value as NSString
        let matches = numeric.matches(in: value, range: NSRange(location: 0, length: source.length))
        let result = NSMutableString(string: value)
        for match in matches.reversed() {
            let number = source.substring(with: match.range(at: 1))
            let code = number.hasPrefix("x") ? UInt32(number.dropFirst(), radix: 16) : UInt32(number)
            if let code, let scalar = UnicodeScalar(code) { result.replaceCharacters(in: match.range, with: String(scalar)) }
        }
        value = result as String
        for (entity, character) in [("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&apos;", "'"), ("&amp;", "&")] {
            value = value.replacingOccurrences(of: entity, with: character)
        }
        return value.replacingOccurrences(of: #"\n[ \t]*\n(?:[ \t]*\n)+"#, with: "\n\n", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Applies only unambiguous inline styling to the canonical plain-text body.
/// Parsing never creates a web view or fetches HTML resources.
enum EmailBodyFormatting {
    struct Span: Equatable {
        enum Style: Equatable { case bold, italic, link(URL) }
        let range: NSRange
        let style: Style
    }
    private static let patterns: [(NSRegularExpression, String)] = ["strong", "b", "em", "i", "a"].map { tag in
        (try! NSRegularExpression(pattern: "<" + tag + #"\b([^>]*)>(.*?)</"# + tag + #"\s*>"#, options: [.caseInsensitive, .dotMatchesLineSeparators]), tag)
    }
    private static let href = try! NSRegularExpression(pattern: #"\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#, options: .caseInsensitive)
    /// The rich MIME alternative is the email shown by the web reader. A text
    /// alternative may contain ASCII emphasis markers that must not leak into it.
    static func nativeText(html: String, plainText: String) -> String {
        let richText = EmailPlainText.fromHTML(html)
        return richText.isEmpty ? plainText : richText
    }
    static func spans(html: String, plainText: String) -> [Span] {
        let html = html.replacingOccurrences(of: #"(?is)<(script|style)\b[^>]*>.*?</\1\s*>"#, with: "", options: .regularExpression)
        let source = html as NSString
        let plain = plainText as NSString
        var spans: [Span] = []
        for (regex, tag) in patterns {
            for match in regex.matches(in: html, range: NSRange(location: 0, length: source.length)) {
                let phrase = EmailPlainText.fromHTML(source.substring(with: match.range(at: 2)))
                guard !phrase.isEmpty else { continue }
                let range = plain.range(of: phrase)
                guard range.location != NSNotFound else { continue }
                // Different MIME alternatives sometimes repeat content. Keep it plain rather
                // than assigning HTML styling or a link to the wrong occurrence.
                let remainder = NSRange(location: NSMaxRange(range), length: plain.length - NSMaxRange(range))
                guard plain.range(of: phrase, range: remainder).location == NSNotFound else { continue }
                let style: Span.Style
                if tag == "a" {
                    let attrs = source.substring(with: match.range(at: 1)) as NSString
                    guard let value = href.firstMatch(in: attrs as String, range: NSRange(location: 0, length: attrs.length)),
                          let index = (1...3).first(where: { value.range(at: $0).location != NSNotFound }),
                          let url = URL(string: EmailPlainText.fromHTML(attrs.substring(with: value.range(at: index)))),
                          ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") else { continue }
                    style = .link(url)
                } else { style = ["strong", "b"].contains(tag) ? .bold : .italic }
                spans.append(Span(range: range, style: style))
            }
        }
        return spans
    }
}
