import XCTest
@testable import MacroNative

@MainActor
final class EmailTests: XCTestCase {
    func testExistingScheduledDraftLocksDeliveryUntilExplicitCancellation() async throws {
        let service = FixtureEmailService()
        var draft = EmailComposition(inboxID: service.demoInbox.id)
        draft.to = "person@example.com"; draft.body = "Keep this body"; draft.sendTime = .now.addingTimeInterval(3600)
        let original = EmailComposeStore(draft: draft, service: service)
        let scheduled = await original.send(); XCTAssertTrue(scheduled)
        let thread = try await service.thread(try XCTUnwrap(original.draft.threadID), offset: 0)
        let editing = EmailComposeStore(draft: .editing(try XCTUnwrap(thread.messages.first)), service: service)
        XCTAssertNotNil(editing.draft.scheduledAt)
        let sentWhileLocked = await editing.send(); XCTAssertFalse(sentWhileLocked)
        XCTAssertTrue(service.sentInputs.isEmpty)
        await editing.cancelSchedule()
        XCTAssertNil(editing.draft.scheduledAt); XCTAssertNil(editing.draft.sendTime)
        XCTAssertEqual(editing.draft.body, "Keep this body")
        XCTAssertTrue(service.scheduledIDs.isEmpty)
    }
    func testSchedulingSavesCompleteDraftThenUsesExplicitScheduleWithoutSending() async throws {
        let service = FixtureEmailService()
        var draft = EmailComposition(inboxID: service.demoInbox.id)
        draft.to = "teammate@example.com"; draft.body = "Scheduled body"; draft.includeSignature = false
        draft.sendTime = Date().addingTimeInterval(3600)
        let model = EmailComposeStore(draft: draft, service: service)
        XCTAssertTrue(service.scheduledIDs.isEmpty)
        let sent = await model.send()
        XCTAssertTrue(sent); XCTAssertTrue(service.sentInputs.isEmpty)
        XCTAssertEqual(service.scheduledIDs, [try XCTUnwrap(model.draft.draftID)])
        XCTAssertEqual(service.savedInputs.last?.include_signature, false)
    }
    func testScheduleTransportUsesInboxHeaderISOTimeAndExplicitSignatureOverride() async throws {
        let api = EmailAPI(baseURL: URL(string: "https://example.invalid")!) { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.url?.path, "/email/email/drafts/scheduled/draft-id")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Email-Link-Id"), "inbox-id")
            let body = try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as! [String: Any]
            XCTAssertEqual(body["send_time"] as? String, "2030-01-01T10:00:00Z")
            XCTAssertEqual(body["include_signature"] as? Bool, false)
            return Data("{}".utf8)
        }
        try await api.schedule("draft-id", inboxID: "inbox-id", sendTime: MessageDate.parse("2030-01-01T10:00:00Z"), includeSignature: false)
    }
    func testAbsentSignatureOverridePreservesServerDefaultAndInboxHTMLIsDecoded() throws {
        let inbox = try JSONDecoder().decode(EmailInbox.self, from: Data(#"{"id":"inbox","email_address":"me@example.com","is_primary":true,"needs_reauth":false,"settings":{"signature":"<b>Name</b>","signature_on_replies_forwards":true}}"#.utf8))
        XCTAssertEqual(inbox.settings?.signature, "<b>Name</b>")
        let input = try EmailComposition(inboxID: inbox.id).input(requireRecipients: false)
        let wire = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as! [String: Any]
        XCTAssertNil(wire["include_signature"])
    }
    func testMobileEmailViewsAndDrawerFiltersUseCanonicalServerLiterals() throws {
        XCTAssertEqual(EmailTab.allCases.map(\.rawValue), ["Signal", "Noise", "Sent", "Scheduled", "Calendar", "Drafts", "Shared", "All"])
        let calendar = EmailAPI.listBody(.init(tab: .calendar, readOnly: true, done: false))
        let text = String(decoding: try JSONSerialization.data(withJSONObject: calendar["ef"]!), as: UTF8.self)
        XCTAssertTrue(text.contains("\"CalendarOnly\":true")); XCTAssertTrue(text.contains("\"Shared\":\"exclude\""))
        XCTAssertTrue(text.contains("\"Read\":true")); XCTAssertTrue(text.contains("\"InboxVisible\":true"))
        XCTAssertEqual(calendar["emailView"] as? String, "all")
        let shared = String(decoding: try JSONSerialization.data(withJSONObject: EmailAPI.listBody(.init(tab: .shared))["ef"]!), as: UTF8.self)
        XCTAssertTrue(shared.contains("\"Shared\":\"only\""))
        XCTAssertEqual(EmailAttachmentKind.classify(mime: "application/pdf", name: "file"), .pdf)
        XCTAssertEqual(EmailAttachmentKind.classify(mime: "image/png", name: "image"), .image)
        XCTAssertEqual(EmailAttachmentKind.classify(mime: "application/octet-stream", name: "notes.docx"), .document)
        XCTAssertNil(EmailAttachmentKind.classify(mime: "text/calendar", name: "invite.ics"))
    }

    func testScheduledMailboxUsesExplicitInboxReadAndDeduplicatesSoonestThread() async throws {
        let message: [String: Any] = ["db_id": "draft", "thread_db_id": "thread", "link_id": "inbox", "to": [["email": "teammate@example.com"]],
            "cc": [], "bcc": [], "subject": "Scheduled", "is_draft": true, "is_read": true, "is_sent": false, "is_starred": false,
            "created_at": "2026-09-27T10:00:00Z", "attachments": [], "scheduled_send_time": "2026-09-28T10:00:00Z"]
        var later = message; later["db_id"] = "later"; later["scheduled_send_time"] = "2026-09-29T10:00:00Z"
        var sent = message; sent["db_id"] = "sent"; sent["thread_db_id"] = "sent-thread"; sent["is_sent"] = true
        let response = try JSONSerialization.data(withJSONObject: ["messages": [later, sent, message]])
        let api = EmailAPI(baseURL: URL(string: "https://example.invalid")!) { request in
            XCTAssertEqual(request.httpMethod, "GET"); XCTAssertEqual(request.url?.path, "/email/email/drafts/scheduled")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Email-Link-Id"), "inbox")
            return response
        }
        let page = try await api.page(.init(tab: .scheduled, inboxID: "inbox"), cursor: nil)
        XCTAssertEqual(page.items.map(\.id), ["thread"])
        XCTAssertEqual(page.items[0].scheduledAt, MessageDate.parse("2026-09-28T10:00:00Z"))
        XCTAssertEqual(page.items[0].sender, "teammate@example.com")
        XCTAssertNil(page.cursor)
    }
    func testNativeReaderUsesHTMLAlternativeWithoutPlainTextEmphasisMarkers() {
        let plain = "Hi! I reinstalled *Macro CRM*."
        let html = "<div>Hi! I reinstalled <b>Macro CRM</b>.</div>"
        let text = EmailBodyFormatting.nativeText(html: html, plainText: plain)
        XCTAssertEqual(text, "Hi! I reinstalled Macro CRM.")
        XCTAssertEqual(EmailBodyFormatting.spans(html: html, plainText: text), [.init(range: (text as NSString).range(of: "Macro CRM"), style: .bold)])
        XCTAssertEqual(plain, "Hi! I reinstalled *Macro CRM*.", "Projection must not rewrite outgoing or stored message text")
    }

    func testNativeReaderPreservesLiteralPlainTextWhenNoRichAlternativeExists() {
        XCTAssertEqual(EmailBodyFormatting.nativeText(html: "", plainText: "2 * 3 = 6, *literal*"), "2 * 3 = 6, *literal*")
        XCTAssertEqual(EmailBodyFormatting.nativeText(html: "<img src='https://example.invalid/image'><style>hidden</style>", plainText: "Photo attached"), "Photo attached")
        XCTAssertEqual(EmailBodyFormatting.nativeText(html: "<div>Hello 👋</div><blockquote>Quoted &amp; safe<br>Next line</blockquote>", plainText: "Alternative"), "Hello 👋\nQuoted & safe\nNext line")
    }

    func testNativeBodyFormattingKeepsUnicodeAndRejectsUnsafeLinks() {
        let text = "👋 A & B and emphasis. Read this. Duplicate Duplicate"
        let html = #"<strong>A &amp; B</strong> and <em>emphasis</em>. <a href="https://macro.com/app">Read this</a>. <b>Duplicate</b><a href="javascript:alert(1)">👋</a><style><b>and</b></style>"#
        let spans = EmailBodyFormatting.spans(html: html, plainText: text)
        XCTAssertEqual(spans.count, 3)
        XCTAssertTrue(spans.contains(.init(range: (text as NSString).range(of: "A & B"), style: .bold)))
        XCTAssertTrue(spans.contains(.init(range: (text as NSString).range(of: "emphasis"), style: .italic)))
        XCTAssertTrue(spans.contains(.init(range: (text as NSString).range(of: "Read this"), style: .link(URL(string: "https://macro.com/app")!))))
    }

    func testHTMLOnlyReplyReadsAndForwardsQuotedContentWithoutMarkup() async throws {
        let fixture = FixtureEmailService()
        var message = try await fixture.thread("demo-email-design", offset: 0).messages[0]
        message.body_text = nil
        message.body_html_sanitized = #"<style>body{background:url(https://example.invalid/pixel)}</style><div>Hi &quot;Alex&quot;,</div><div>Looks <strong>great 👋</strong>.</div><blockquote><div>On Sep 26, Jamie &lt;jamie@example.com&gt; wrote:</div><div>Can you check <a href="https://macro.com/app">this document</a>?</div></blockquote><img src="https://example.invalid/pixel">"#
        XCTAssertEqual(message.text, "Hi \"Alex\",\nLooks great 👋.\nOn Sep 26, Jamie <jamie@example.com> wrote:\nCan you check this document?")
        let forward = EmailComposition.forward(message, inboxID: fixture.demoInbox.id)
        XCTAssertTrue(forward.body.contains(message.text))
        XCTAssertFalse(forward.body.contains("<blockquote>"))
        XCTAssertFalse(forward.body.contains("example.invalid/pixel"))
        let spans = EmailBodyFormatting.spans(html: message.body_html_sanitized!, plainText: message.text)
        XCTAssertEqual(spans.count, 2)
    }

    func testSignalQueryScopesEveryEntityAndAccountBeforePagination() throws {
        let body = EmailAPI.listBody(EmailQuery(tab: .signal, inboxID: "work-inbox", unreadOnly: true))
        XCTAssertEqual(body["emailView"] as? String, "inbox")
        XCTAssertEqual(body["limit"] as? Int, 50)
        for key in ["df", "cf", "pf", "chanf", "cthf", "callf", "calf", "ccf", "fef", "asf", "remf"] { XCTAssertNotNil(body[key], key) }
        let data = try JSONSerialization.data(withJSONObject: body["ef"]!)
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(text.contains("\"Importance\":true"))
        XCTAssertTrue(text.contains("\"Owner\":\"work-inbox\""))
        XCTAssertTrue(text.contains("\"Read\":false"))
        XCTAssertFalse(text.contains("isImportant"), "Macro Signal must not be confused with Gmail IMPORTANT")
        let noise = EmailAPI.listBody(EmailQuery(tab: .noise))
        XCTAssertTrue(String(decoding: try JSONSerialization.data(withJSONObject: noise["ef"]!), as: UTF8.self).contains("\"Importance\":false"))
    }

    func testSoupDecodesActualTagAndCanonicalSignalWithInboxMetadata() throws {
        let data = Data(#"{"items":[{"tag":"emailThread","data":{"id":"thread","name":"Hello","senderName":"Jamie","senderEmail":"jamie@example.com","sortTs":"2026-09-27T12:00:00Z","isRead":false,"isDraft":false,"isImportant":false,"isSignal":true,"inboxVisible":true,"labels":[{"linkId":"inbox","providerLabelId":"STARRED"}],"participants":[],"attachments":[]}}],"next_cursor":"next+page"}"#.utf8)
        let page = try EmailAPI.soupPage(data)
        XCTAssertEqual(page.items.count, 1)
        XCTAssertEqual(page.items[0].linkID, "inbox")
        XCTAssertTrue(page.items[0].isSignal)
        XCTAssertTrue(page.items[0].isStarred)
        XCTAssertEqual(page.cursor, "next+page")
    }

    func testSendUsesExactMessageEnvelopeAndExplicitInboxWithoutHTMLConversion() async throws {
        var requests: [URLRequest] = []
        let api = EmailAPI(baseURL: URL(string: "https://example.invalid")!) { request in requests.append(request); return Data("{}".utf8) }
        let draft = EmailDraftInput(subject: "Hello", to: [.init(email: "jamie@example.com")], cc: [], bcc: [], body_text: "Plain text\n第二行", db_id: nil, thread_db_id: "thread", provider_id: nil, provider_thread_id: "provider", replying_to_id: "reply")
        try await api.send(draft, inboxID: "work-inbox")
        XCTAssertEqual(requests.count, 1)
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.url?.path, "/email/email/messages")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Email-Link-Id"), "work-inbox")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        let message = try XCTUnwrap(body["message"] as? [String: Any])
        XCTAssertEqual(message["body_text"] as? String, draft.body_text)
        XCTAssertEqual(message["replying_to_id"] as? String, "reply")
        XCTAssertNil(message["body_html"])
    }

    func testSearchRequestsIncludeAccountAndReadFiltersAndDecodeMetadata() async throws {
        let api = EmailAPI(baseURL: URL(string: "https://example.invalid")!) { request in
            XCTAssertEqual(request.url?.path, "/dss/search")
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
            let filters = try XCTUnwrap(body["filters"] as? [String: Any])
            let email = try XCTUnwrap(filters["email_filters"] as? [String: Any])
            XCTAssertEqual(email["link_ids"] as? [String], ["inbox"])
            XCTAssertEqual(email["is_read"] as? Bool, false)
            return Data(#"{"results":[{"type":"email","id":"t","thread_id":"t","link_id":"inbox","name":"Found","is_read":false,"updated_at":"2026-09-27T12:00:00Z","email_message_search_results":[{"pretty_sender":"Jamie","sender":"jamie@example.com"}]}],"next_cursor":null}"#.utf8)
        }
        let result = try await api.page(EmailQuery(tab: .all, inboxID: "inbox", unreadOnly: true, text: "Jamie"), cursor: nil)
        XCTAssertEqual(result.items.first?.subject, "Found")
        XCTAssertEqual(result.items.first?.sender, "Jamie")
    }

    func testRecipientsRejectInvalidAddressesAndDeduplicateCaseInsensitively() throws {
        XCTAssertThrowsError(try EmailRecipients.parse("someone, okay@example.com"))
        let result = try EmailRecipients.parse("Jamie Chen <jamie@example.com>; JAMIE@example.com\nother@example.com")
        XCTAssertEqual(result.map(\.email), ["jamie@example.com", "other@example.com"])
        XCTAssertEqual(result.first?.name, "Jamie Chen")
    }

    func testReplyAllExcludesOwnInboxAndForwardDoesNotReuseOriginalThread() async throws {
        let fixture = FixtureEmailService()
        var message = try await fixture.thread("demo-email-design", offset: 0).messages[0]
        message.to += [.init(email: "other@example.com"), .init(email: "jamie@macro.local")]
        message.cc = [.init(email: "OTHER@example.com"), .init(email: "cc@example.com")]
        let reply = EmailComposition.reply(to: message, inbox: fixture.demoInbox, all: true)
        XCTAssertEqual(reply.to, "jamie@macro.local")
        XCTAssertEqual(reply.cc, "other@example.com, cc@example.com")
        XCTAssertEqual(reply.threadID, message.thread_db_id)
        XCTAssertEqual(reply.replyingToID, message.id)
        let forward = EmailComposition.forward(message, inboxID: fixture.demoInbox.id)
        XCTAssertNil(forward.threadID)
        XCTAssertNil(forward.replyingToID)
        XCTAssertTrue(forward.body.contains(message.text))
    }

    func testComposeNeverSendsUntilExplicitActionAndKeepsFailedDraft() async throws {
        let fixture = FixtureEmailService()
        var draft = EmailComposition(inboxID: fixture.demoInbox.id)
        draft.to = "jamie@macro.local"; draft.subject = "Native email"; draft.body = "Keep my text"
        let composer = EmailComposeStore(draft: draft, service: fixture)
        XCTAssertTrue(fixture.sentInputs.isEmpty)
        fixture.shouldFailSend = true
        let failed = await composer.send()
        XCTAssertFalse(failed)
        XCTAssertEqual(composer.draft.body, "Keep my text")
        XCTAssertFalse(composer.completed)
        XCTAssertFalse(composer.isWorking)
        fixture.shouldFailSend = false
        let sent = await composer.send()
        XCTAssertTrue(sent)
        XCTAssertEqual(fixture.sentInputs.count, 1)
    }

    func testForwardPersistsAttachmentReferencesBeforeSendingAndDoesNotDuplicateOnRetry() async throws {
        let fixture = FixtureEmailService()
        var draft = EmailComposition(inboxID: fixture.demoInbox.id)
        draft.to = "jamie@macro.local"
        draft.forwardedAttachments = [.init(db_id: "attachment", filename: "plan.pdf", mime_type: "application/pdf", size_bytes: 12)]
        let composer = EmailComposeStore(draft: draft, service: fixture)
        fixture.shouldFailSend = true
        _ = await composer.send()
        XCTAssertNotNil(composer.draft.draftID)
        XCTAssertEqual(fixture.forwardedIDs, ["attachment"])
        fixture.shouldFailSend = false
        let sent = await composer.send()
        XCTAssertTrue(sent)
        XCTAssertEqual(fixture.forwardedIDs, ["attachment"])
        XCTAssertEqual(fixture.sentInputs.first?.db_id, composer.draft.draftID)
    }

    func testThreadReadStarArchiveAndUnreadAdmissionAreRealServiceMutations() async throws {
        let fixture = FixtureEmailService()
        let workspace = EmailStore(service: fixture)
        workspace.query.unreadOnly = true
        await workspace.load()
        XCTAssertEqual(workspace.items.map(\.id), ["demo-email-design"])
        let thread = EmailThreadStore(id: "demo-email-design", workspace: workspace)
        await thread.load()
        XCTAssertTrue(try XCTUnwrap(thread.thread).is_read)
        XCTAssertEqual(workspace.items.count, 1, "Opening an unread thread keeps its admitted row")
        await thread.toggleStar()
        XCTAssertTrue(try XCTUnwrap(fixture.threads[thread.id]).isStarred)
        await thread.archive()
        XCTAssertFalse(try XCTUnwrap(fixture.threads[thread.id]).inbox_visible)
        XCTAssertTrue(workspace.items.isEmpty)
    }

    func testSwitchingTabsDoesNotReusePreviousMailboxResults() async throws {
        let workspace = EmailStore(service: FixtureEmailService())
        await workspace.load()
        XCTAssertEqual(workspace.items.count, 2)
        workspace.query.tab = .noise
        await workspace.reload()
        XCTAssertEqual(workspace.items.map(\.id), ["demo-email-update"])
        workspace.query.tab = .drafts
        await workspace.reload()
        XCTAssertTrue(workspace.items.isEmpty)
    }
    func testAttachmentHashAndSignedUploadHeadersMatchWebContract() throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent("email-test-\(UUID().uuidString).txt")
        try Data("hello".utf8).write(to: source)
        defer { try? FileManager.default.removeItem(at: source) }
        let file = try EmailLocalAttachment.importFile(source)
        defer { file.removeLocalFile() }
        XCTAssertEqual(file.sha, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
        let ticket = EmailUploadTicket(attachment_id: "attachment", content_type: "text/plain", upload_url: "https://storage.example.invalid/signed")
        let request = try EmailAPI.uploadRequest(file, ticket: ticket)
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "text/plain")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-amz-checksum-sha256"), "LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNotEqual(file.localURL, source)
    }

    func testFailedAttachmentUploadBlocksSendAndRetriesOnlyAfterRecordRemoval() async throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent("email-test-\(UUID().uuidString).txt")
        try Data("attachment".utf8).write(to: source)
        defer { try? FileManager.default.removeItem(at: source) }
        let fixture = FixtureEmailService()
        var draft = EmailComposition(inboxID: fixture.demoInbox.id)
        draft.to = "jamie@macro.local"
        let composer = EmailComposeStore(draft: draft, service: fixture)
        await composer.addFiles([source])
        XCTAssertEqual(composer.draft.localAttachments.count, 1)
        fixture.shouldFailUpload = true
        let failed = await composer.send()
        XCTAssertFalse(failed)
        XCTAssertTrue(fixture.sentInputs.isEmpty)
        XCTAssertEqual(fixture.removedAttachmentRecords, fixture.attachmentRecords)
        XCTAssertNil(composer.draft.localAttachments[0].ticket)
        fixture.shouldFailUpload = false
        let sent = await composer.send()
        XCTAssertTrue(sent)
        XCTAssertEqual(fixture.sentInputs.count, 1)
        XCTAssertEqual(fixture.attachmentRecords.count, 2)
    }

    func testHTMLOnlyMessageHasReadableNativeTextWithoutTrackingOrStyleContent() {
        let html = "<style>p{color:red}</style><p>Hello &amp; welcome &#x1F44B;</p><p>Second line<br>Next</p><img src='https://tracker.invalid/pixel'>"
        XCTAssertEqual(EmailPlainText.fromHTML(html), "Hello & welcome 👋\nSecond line\nNext")
    }

    func testMobileRecipientSummaryPreservesWireRecipientsAndNamedAddresses() throws {
        let input = "Jamie Chen <jamie@macro.local>, Zoë 🎨 <zoe@macro.local>, alex@macro.local, sam@macro.local"
        let recipients = try EmailRecipients.parse(input)
        XCTAssertEqual(EmailRecipientSummary.label(recipients), "Jamie Chen, Zoë 🎨 & 2 more…")
        XCTAssertEqual(recipients.map(\.email), ["jamie@macro.local", "zoe@macro.local", "alex@macro.local", "sam@macro.local"])
        XCTAssertEqual(EmailRecipientSummary.label(Array(recipients.prefix(1))), "Jamie Chen")
        XCTAssertEqual(EmailRecipientSummary.label([]), "")
    }

    func testMobileInboxProjectsParticipantsAndCalendarAttachmentsWithoutChangingAddresses() throws {
        let data = Data(#"{"items":[{"tag":"emailThread","data":{"id":"thread","senderName":"raw@example.com","senderEmail":"raw@example.com","sortTs":"2026-09-26T12:00:00Z","participants":[{"emailAddress":"me@example.com","name":"Me"},{"emailAddress":"raw@example.com","name":"Jamie Chen"},{"emailAddress":"zoe@example.com","name":"Zoë Martin"}],"attachments":[{"filename":"invite.ics","mimeType":"text/calendar"}]}}]}"#.utf8)
        let preview = try XCTUnwrap(EmailAPI.soupPage(data).items.first)
        XCTAssertEqual(preview.senderLabel(excluding: ["me@example.com"]), "Jamie, Zoë")
        XCTAssertEqual(preview.senderEmail, "raw@example.com")
        XCTAssertTrue(preview.isCalendarInvite)
        XCTAssertEqual(EmailDateGrouping.title(preview.date, now: MessageDate.parse("2026-09-27T12:00:00Z")), "Yesterday")
    }

    func testInboxInitiallyUsesPrimaryAccountAndRetainsExplicitAllInboxes() async {
        let fixture = FixtureEmailService(); let workspace = EmailStore(service: fixture)
        await workspace.loadInboxes()
        XCTAssertEqual(workspace.query.inboxID, fixture.demoInbox.id)
        workspace.query.inboxID = nil
        await workspace.loadInboxes()
        XCTAssertNil(workspace.query.inboxID, "An explicit All inboxes choice must survive reloads")
    }

}
