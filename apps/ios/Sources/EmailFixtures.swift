#if DEBUG
import Foundation

/// Local-only mailbox. It has no network transport and cannot send real email.
@MainActor
final class FixtureEmailService: EmailService {
    let demoInbox = EmailInbox(id: "demo-inbox", email_address: "alex@macro.local", is_primary: true, needs_reauth: false, is_sync_active: true, settings: EmailInboxSettings(signature: "<p>Alex Morgan<br>Macro</p>", signature_on_replies_forwards: true))
    private(set) var threads: [String: EmailThread] = [:]
    private(set) var sentInputs: [EmailDraftInput] = []
    private(set) var savedInputs: [EmailDraftInput] = []
    private(set) var forwardedIDs: [String] = []
    private(set) var scheduledIDs: [String] = []
    var shouldFailSend = false
    var shouldFailUpload = false
    private(set) var attachmentRecords: [String] = []
    private(set) var removedAttachmentRecords: [String] = []
    init() {
        let examples: [(String, String, String, String, Bool)] = [
            ("demo-email-design", "Jamie Chen", "jamie@macro.local", "A few thoughts on the mobile design", true),
            ("demo-email-launch", "Taylor Lee", "taylor@macro.local", "Launch plan for next week", true),
            ("demo-email-update", "Macro updates", "news@macro.local", "Your weekly workspace update", false)
        ]
        for (index, entry) in examples.enumerated() {
            let stamp = MessageDate.string(Date().addingTimeInterval(-Double(index + 1) * 3600))
            let message = EmailMessage(db_id: entry.0 + "-message", thread_db_id: entry.0, link_id: demoInbox.id,
                from: EmailContact(email: entry.2, name: entry.1), to: [EmailContact(email: demoInbox.email_address, name: "Alex Morgan")], cc: [], bcc: [],
                subject: entry.3, snippet: "The native experience is looking good. Let's keep the small details feeling fast.",
                body_text: "Hey Alex,\n\nThe native experience is looking good. Let's keep the small details feeling fast.\n\nI left a few ideas in the Product & design channel. Would love your thoughts before our next review.\n\nThanks,\n\(entry.1)",
                body_html_sanitized: "<p>Hey Alex,</p><p>The <strong>native experience</strong> is looking good.</p><p>Thanks,<br>\(entry.1)</p>",
                is_draft: false, is_read: index > 0, is_sent: false, is_starred: false, created_at: stamp, sent_at: stamp,
                provider_id: nil, provider_thread_id: "provider-\(entry.0)", replying_to_id: nil, attachments: index == 0 ? [.init(db_id: "demo-design-attachment", filename: "Mobile design.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size_bytes: 18432)] : [])
            threads[entry.0] = EmailThread(db_id: entry.0, link_id: demoInbox.id, inbox_visible: true, is_read: index > 0, messages: [message], provider_id: message.provider_thread_id)
        }
    }
    func inboxes() async throws -> [EmailInbox] { [demoInbox] }
    func page(_ query: EmailQuery, cursor: String?) async throws -> EmailPage {
        let items = threads.values.compactMap { thread -> EmailPreview? in
            guard let last = thread.messages.last else { return nil }
            let signal = thread.id != "demo-email-update"
            if let inbox = query.inboxID, inbox != thread.link_id { return nil }
            if query.unreadOnly && thread.is_read { return nil }
            if query.readOnly && !thread.is_read { return nil }
            if let done = query.done, thread.inbox_visible == done { return nil }
            if query.tab == .shared { return nil }
            if query.tab == .scheduled && (!last.is_draft || last.scheduled_send_time == nil) { return nil }
            let calendarInvite = last.attachments.contains { $0.filename?.lowercased().hasSuffix(".ics") == true || $0.mime_type == "text/calendar" }
            if (query.tab == .calendar || query.calendarOnly) && !calendarInvite { return nil }
            let kinds = Set(last.attachments.compactMap { EmailAttachmentKind.classify(mime: $0.mime_type ?? "", name: $0.filename ?? "") })
            if !query.attachmentKinds.isEmpty && kinds.isDisjoint(with: query.attachmentKinds) { return nil }
            if let importance = query.tab.importance, signal != importance { return nil }
            if query.isSearch {
                let needle = query.text.lowercased()
                guard (last.subject ?? "").lowercased().contains(needle) || last.text.lowercased().contains(needle) || (last.from?.displayName ?? "").lowercased().contains(needle) else { return nil }
            } else {
                if [.signal, .noise].contains(query.tab) && !thread.inbox_visible { return nil }
                if query.tab == .sent && !thread.messages.contains(where: \.is_sent) { return nil }
                if query.tab == .drafts && !thread.messages.contains(where: \.is_draft) { return nil }
            }
            return EmailPreview(id: thread.id, linkID: thread.link_id, subject: thread.subject, sender: last.from?.displayName ?? "Me", senderEmail: last.from?.email ?? "", snippet: last.snippet ?? last.text,
                date: last.date, isRead: thread.is_read, isDraft: thread.messages.contains(where: \.is_draft), isStarred: thread.isStarred, isSignal: signal,
                inboxVisible: thread.inbox_visible, hasAttachments: !last.attachments.isEmpty, isCalendarInvite: calendarInvite, attachmentKinds: kinds)
        }.sorted { $0.date > $1.date }
        return EmailPage(items: items, cursor: nil)
    }
    func thread(_ id: String, offset: Int) async throws -> EmailThread {
        guard var value = threads[id] else { throw EmailError.invalidResponse }
        value.messages = Array(value.messages.sorted { $0.date > $1.date }.dropFirst(offset).prefix(EmailAPI.messagePageSize))
        return value
    }
    func labels() async throws -> [EmailLabel] {
        [EmailLabel(id: "demo-unread", linkId: demoInbox.id, providerLabelId: "UNREAD", name: "Unread"), EmailLabel(id: "demo-starred", linkId: demoInbox.id, providerLabelId: "STARRED", name: "Starred")]
    }
    func seen(_ id: String, inboxID: String) async throws { threads[id]?.is_read = true }
    func archive(_ id: String, inboxID: String, value: Bool) async throws { threads[id]?.inbox_visible = !value }
    func label(_ id: String, inboxID: String, labelID: String, value: Bool) async throws {
        if labelID == "demo-unread" { threads[id]?.is_read = !value }
        if labelID == "demo-starred", var thread = threads[id] {
            for index in thread.messages.indices { thread.messages[index].is_starred = value }
            threads[id] = thread
        }
    }
    func save(_ input: EmailDraftInput, inboxID: String) async throws -> EmailDraftResult {
        savedInputs.append(input)
        return insert(input, inboxID: inboxID, sent: false)
    }
    func send(_ input: EmailDraftInput, inboxID: String) async throws {
        if shouldFailSend { throw URLError(.notConnectedToInternet) }
        sentInputs.append(input)
        _ = insert(input, inboxID: inboxID, sent: true)
    }
    func unschedule(_ draftID: String, inboxID: String) async throws {
        for key in threads.keys {
            if let index = threads[key]?.messages.firstIndex(where: { $0.id == draftID }) { threads[key]?.messages[index].scheduled_send_time = nil }
        }
        scheduledIDs.removeAll { $0 == draftID }
    }
    func schedule(_ draftID: String, inboxID: String, sendTime: Date, includeSignature: Bool?) async throws {
        guard threads.values.contains(where: { $0.messages.contains(where: { $0.id == draftID }) }) else { throw EmailError.missingDraft }
        for key in threads.keys {
            if let index = threads[key]?.messages.firstIndex(where: { $0.id == draftID }) {
                threads[key]?.messages[index].scheduled_send_time = MessageDate.string(sendTime)
            }
        }
        scheduledIDs.append(draftID)
    }
    func forwardAttachment(_ id: String, draftID: String, inboxID: String) async throws { forwardedIDs.append(id) }
    func createAttachment(_ attachment: EmailLocalAttachment, draftID: String, inboxID: String) async throws -> EmailUploadTicket {
        let id = "demo-attachment-\(UUID().uuidString)"
        attachmentRecords.append(id)
        return EmailUploadTicket(attachment_id: id, content_type: "application/octet-stream", upload_url: "https://example.invalid/fixture-only")
    }
    func uploadAttachment(_ attachment: EmailLocalAttachment, ticket: EmailUploadTicket) async throws { if shouldFailUpload { throw EmailAttachmentError.uploadFailed } }
    func removeAttachment(_ id: String, draftID: String, inboxID: String, forwarded: Bool) async throws { removedAttachmentRecords.append(id) }
    func attachmentURL(_ id: String) async throws -> URL { throw EmailAttachmentError.invalidURL }
    private func insert(_ input: EmailDraftInput, inboxID: String, sent: Bool) -> EmailDraftResult {
        let threadID = input.thread_db_id ?? "demo-email-\(UUID().uuidString)"
        let messageID = input.db_id ?? "demo-message-\(UUID().uuidString)"
        let stamp = MessageDate.string()
        let message = EmailMessage(db_id: messageID, thread_db_id: threadID, link_id: inboxID,
            from: EmailContact(email: demoInbox.email_address, name: "Alex Morgan"), to: input.to, cc: input.cc, bcc: input.bcc,
            subject: input.subject, snippet: String(input.body_text.prefix(120)), body_text: input.body_text,
            body_html_sanitized: nil, is_draft: !sent, is_read: true, is_sent: sent, is_starred: false, created_at: stamp, sent_at: sent ? stamp : nil,
            provider_id: nil, provider_thread_id: input.provider_thread_id, replying_to_id: input.replying_to_id, attachments: [], body_macro: input.body_macro)
        var thread = threads[threadID] ?? EmailThread(db_id: threadID, link_id: inboxID, inbox_visible: false, is_read: true, messages: [], provider_id: nil)
        thread.messages.removeAll { $0.id == messageID }
        thread.messages.append(message)
        threads[threadID] = thread
        return EmailDraftResult(db_id: messageID, thread_db_id: threadID, provider_id: nil, provider_thread_id: input.provider_thread_id)
    }
}
#endif
