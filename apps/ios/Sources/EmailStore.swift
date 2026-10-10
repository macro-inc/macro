import Foundation
import Observation

@MainActor @Observable
final class EmailStore {
    let service: any EmailService
    let session: NativeSession?
    var query = EmailQuery() {
        didSet {
            guard query != oldValue else { return }
            generation += 1
            items = cached[query]?.items ?? []
            cursor = cached[query]?.cursor
            isLoading = true; isLoadingMore = false; error = nil
        }
    }
    private(set) var inboxes: [EmailInbox] = []
    private(set) var items: [EmailPreview] = []
    private(set) var cursor: String?
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var didLoad = false
    private(set) var loadedQuery: EmailQuery?
    var error: String?
    var notice: String?
    var composition: EmailComposition?
    var localDraft: EmailComposition?
    private var generation = 0
    private var cached: [EmailQuery: EmailPage] = [:]
    private var knownLabels: [EmailLabel] = []

    init(service: any EmailService, session: NativeSession? = nil) { self.service = service; self.session = session }
    convenience init(session: NativeSession) {
        #if DEBUG
        if session.isDemo { self.init(service: FixtureEmailService(), session: session); return }
        #endif
        self.init(service: EmailAPI(session: session), session: session)
    }
    var selectedInbox: EmailInbox? { inboxes.first { $0.id == query.inboxID } }
    var sendingInbox: EmailInbox? {
        if query.inboxID != nil { return selectedInbox.flatMap { $0.needs_reauth ? nil : $0 } }
        return inboxes.first { $0.is_primary && !$0.needs_reauth } ?? inboxes.first { !$0.needs_reauth }
    }
    var inboxTitle: String { selectedInbox?.email_address ?? "All inboxes" }

    func loadInboxes() async {
        guard !didLoad else { return }
        do {
            inboxes = try await service.inboxes(); didLoad = true; error = nil
            if query.inboxID == nil { query.inboxID = inboxes.first { $0.is_primary }?.id ?? inboxes.first?.id }
        }
        catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    func load() async {
        await loadInboxes()
        guard didLoad else { isLoading = false; return }
        await reload()
    }
    func reload() async {
        generation += 1
        let version = generation
        let requested = query
        let prior = cached[requested]
        items = prior?.items ?? []
        cursor = prior?.cursor
        isLoading = true; isLoadingMore = false; error = nil
        defer { if generation == version { isLoading = false } }
        do {
            let page = try await service.page(requested, cursor: nil)
            guard version == generation, requested == query, !Task.isCancelled else { return }
            items = page.items; cursor = page.cursor; loadedQuery = requested
            cache()
        } catch { if version == generation && !Task.isCancelled { self.error = error.localizedDescription } }
    }
    func loadMore() async {
        guard !isLoading, !isLoadingMore, let cursor else { return }
        let version = generation
        let requested = query
        isLoadingMore = true
        defer { if generation == version { isLoadingMore = false } }
        do {
            let page = try await service.page(requested, cursor: cursor)
            guard version == generation, requested == query, !Task.isCancelled else { return }
            var ids = Set(items.map(\.id))
            items += page.items.filter { ids.insert($0.id).inserted }
            self.cursor = page.cursor == cursor ? nil : page.cursor
            cache()
        } catch { if version == generation { self.error = error.localizedDescription } }
    }
    func compose() {
        if let localDraft { composition = localDraft; self.localDraft = nil; return }
        guard let inbox = sendingInbox else { error = EmailError.noInbox.localizedDescription; return }
        composition = EmailComposition(inboxID: inbox.id)
    }
    func reply(_ message: EmailMessage, all: Bool) {
        guard let inbox = inboxes.first(where: { $0.id == message.link_id }), !inbox.needs_reauth else { error = EmailError.noInbox.localizedDescription; return }
        composition = EmailComposition.reply(to: message, inbox: inbox, all: all)
    }
    func forward(_ message: EmailMessage) {
        guard let inbox = inboxes.first(where: { $0.id == message.link_id }), !inbox.needs_reauth else { error = EmailError.noInbox.localizedDescription; return }
        composition = EmailComposition.forward(message, inboxID: inbox.id)
    }
    func labelID(_ name: String, inboxID: String) async throws -> String {
        if let label = knownLabels.first(where: { $0.linkId == inboxID && $0.providerLabelId == name }) { return label.id }
        knownLabels = try await service.labels()
        guard let label = knownLabels.first(where: { $0.linkId == inboxID && $0.providerLabelId == name }) else { throw EmailError.missingLabel }
        return label.id
    }
    func update(_ thread: EmailThread) {
        // Preserve already admitted rows while reading an unread-only list, matching mobile web.
        for key in Array(cached.keys) {
            guard var page = cached[key] else { continue }
            if !thread.inbox_visible && (key.tab == .signal || key.tab == .noise) && !key.isSearch {
                page.items.removeAll { $0.id == thread.id }
            } else if let index = page.items.firstIndex(where: { $0.id == thread.id }) {
                page.items[index].isRead = thread.is_read
                page.items[index].isStarred = thread.isStarred
                page.items[index].inboxVisible = thread.inbox_visible
                page.items[index].linkID = thread.link_id
            }
            cached[key] = page
        }
        if let page = cached[query] { items = page.items; cursor = page.cursor }
    }
    func composed(sent: Bool, scheduled: Bool = false) {
        composition = nil; localDraft = nil
        notice = scheduled ? "Email scheduled" : sent ? "Email sent" : "Draft saved"
        cached.removeAll()
        Task { await reload() }
    }
    private func cache() { cached[query] = EmailPage(items: items, cursor: cursor) }
}

@MainActor @Observable
final class EmailThreadStore {
    let workspace: EmailStore
    let id: String
    private(set) var thread: EmailThread?
    private(set) var isLoading = false
    private(set) var isUpdating = false
    private(set) var hasMore = false
    var error: String?
    private var offset = 0
    init(id: String, workspace: EmailStore) { self.id = id; self.workspace = workspace }
    func load(older: Bool = false) async {
        guard !isLoading else { return }
        isLoading = true; error = nil
        defer { isLoading = false }
        do {
            var fetched = try await workspace.service.thread(id, offset: older ? offset : 0)
            let count = fetched.messages.count
            if older, let current = thread {
                var ids = Set(current.messages.map(\.id))
                fetched.messages = current.messages + fetched.messages.filter { ids.insert($0.id).inserted }
            }
            fetched.messages.sort { $0.date < $1.date }
            thread = fetched
            offset = older ? offset + count : count
            hasMore = count == EmailAPI.messagePageSize
            if !fetched.is_read && !older {
                try await workspace.service.seen(id, inboxID: fetched.link_id)
                fetched.is_read = true
                thread = fetched
            }
            workspace.update(fetched)
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    func archive() async {
        await mutate { current in
            try await self.workspace.service.archive(self.id, inboxID: current.link_id, value: current.inbox_visible)
            var changed = current; changed.inbox_visible.toggle(); return changed
        }
    }
    func toggleRead() async {
        await mutate { current in
            if !current.is_read { try await self.workspace.service.seen(self.id, inboxID: current.link_id) }
            else {
                let labelID = try await self.workspace.labelID("UNREAD", inboxID: current.link_id)
                try await self.workspace.service.label(self.id, inboxID: current.link_id, labelID: labelID, value: true)
            }
            var changed = current; changed.is_read.toggle(); return changed
        }
    }
    func toggleStar() async {
        await mutate { current in
            let labelID = try await self.workspace.labelID("STARRED", inboxID: current.link_id)
            let value = !current.isStarred
            try await self.workspace.service.label(self.id, inboxID: current.link_id, labelID: labelID, value: value)
            var changed = current
            for index in changed.messages.indices { changed.messages[index].is_starred = value }
            return changed
        }
    }
    private func mutate(_ operation: (EmailThread) async throws -> EmailThread) async {
        guard let thread, !isUpdating else { return }
        isUpdating = true; error = nil
        defer { isUpdating = false }
        do { let changed = try await operation(thread); self.thread = changed; workspace.update(changed) }
        catch { self.error = error.localizedDescription }
    }
}

@MainActor @Observable
final class EmailComposeStore {
    var draft: EmailComposition
    var isWorking = false
    var error: String?
    var completed = false
    let service: any EmailService
    init(draft: EmailComposition, service: any EmailService) { self.draft = draft; self.service = service }

    func save() async -> Bool {
        guard !isWorking else { return false }
        isWorking = true; error = nil
        defer { isWorking = false }
        do {
            guard draft.scheduledAt == nil else { throw EmailError.scheduledDraftLocked }
            try await prepareForwardedAttachments(alwaysSave: true)
            completed = true
            draft.localAttachments.forEach { $0.removeLocalFile() }
            return true
        }
        catch { self.error = error.localizedDescription; return false }
    }
    func send() async -> Bool {
        guard !isWorking else { return false }
        isWorking = true; error = nil
        defer { isWorking = false }
        do {
            guard draft.scheduledAt == nil else { throw EmailError.scheduledDraftLocked }
            _ = try draft.input(requireRecipients: true)
            if let time = draft.sendTime, time <= .now { throw EmailError.invalidSchedule }
            // Persist an ID before delivery so a connection failure cannot turn a retry into a second new email.
            try await prepareForwardedAttachments(alwaysSave: true)
            if let sendTime = draft.sendTime {
                guard sendTime > .now else { throw EmailError.invalidSchedule }
                guard let id = draft.draftID else { throw EmailError.missingDraft }
                try await service.schedule(id, inboxID: draft.inboxID, sendTime: sendTime, includeSignature: draft.includeSignature)
            } else { try await service.send(draft.input(requireRecipients: true), inboxID: draft.inboxID) }
            completed = true
            for attachment in draft.localAttachments { attachment.removeLocalFile() }
            return true
        } catch {
            if let urlError = error as? URLError, [.timedOut, .networkConnectionLost].contains(urlError.code) {
                self.error = "The connection ended before send was confirmed. Check Sent before trying again to avoid sending twice."
            } else { self.error = error.localizedDescription }
            return false
        }
    }
    func cancelSchedule() async {
        guard !isWorking, draft.scheduledAt != nil, let id = draft.draftID else { return }
        isWorking = true; error = nil
        defer { isWorking = false }
        do {
            try await service.unschedule(id, inboxID: draft.inboxID)
            draft.scheduledAt = nil; draft.sendTime = nil
        } catch { self.error = error.localizedDescription }
    }
    func addFiles(_ urls: [URL]) async {
        guard !isWorking else { return }
        isWorking = true; error = nil
        defer { isWorking = false }
        var imported: [EmailLocalAttachment] = []
        do {
            for url in urls { imported.append(try await Task.detached { try EmailLocalAttachment.importFile(url) }.value) }
            let total = (draft.localAttachments + imported).reduce(0) { $0 + $1.size }
                + draft.existingAttachments.reduce(0) { $0 + $1.size }
                + draft.forwardedAttachments.reduce(0) { $0 + ($1.size_bytes ?? 0) }
                + draft.existingForwards.reduce(0) { $0 + ($1.size_bytes ?? 0) }
            guard total < EmailLocalAttachment.maximumBytes else { throw EmailAttachmentError.tooLarge }
            draft.localAttachments += imported
        } catch {
            imported.forEach { $0.removeLocalFile() }
            self.error = error.localizedDescription
        }
    }
    func removeLocalAttachment(_ item: EmailLocalAttachment) {
        if let ticket = item.ticket { draft.removedAttachments.insert(ticket.attachment_id) }
        draft.localAttachments.removeAll { $0.id == item.id }
        item.removeLocalFile()
    }
    func discardChanges() {
        completed = true
        draft.localAttachments.forEach { $0.removeLocalFile() }
    }
    private func prepareForwardedAttachments(alwaysSave: Bool) async throws {
        if alwaysSave || !draft.forwardedAttachments.isEmpty || !draft.localAttachments.isEmpty || !draft.removedAttachments.isEmpty || !draft.removedForwards.isEmpty {
            let result = try await service.save(draft.input(requireRecipients: false), inboxID: draft.inboxID)
            draft.apply(result)
        }
        guard !draft.forwardedAttachments.isEmpty || !draft.localAttachments.isEmpty || !draft.removedAttachments.isEmpty || !draft.removedForwards.isEmpty else { return }
        guard let draftID = draft.draftID else { throw EmailError.missingDraft }
        for id in draft.removedAttachments {
            try await service.removeAttachment(id, draftID: draftID, inboxID: draft.inboxID, forwarded: false)
            draft.removedAttachments.remove(id)
        }
        for id in draft.removedForwards {
            try await service.removeAttachment(id, draftID: draftID, inboxID: draft.inboxID, forwarded: true)
            draft.removedForwards.remove(id)
        }
        for index in draft.localAttachments.indices where !draft.localAttachments[index].uploaded {
            if draft.localAttachments[index].ticket == nil {
                draft.localAttachments[index].ticket = try await service.createAttachment(draft.localAttachments[index], draftID: draftID, inboxID: draft.inboxID)
            }
            guard let ticket = draft.localAttachments[index].ticket else { throw EmailAttachmentError.uploadFailed }
            do {
                try await service.uploadAttachment(draft.localAttachments[index], ticket: ticket)
                draft.localAttachments[index].uploaded = true
            } catch {
                // Clear an attachment record only once removal is confirmed; never duplicate it on retry.
                if (try? await service.removeAttachment(ticket.attachment_id, draftID: draftID, inboxID: draft.inboxID, forwarded: false)) != nil {
                    draft.localAttachments[index].ticket = nil
                }
                throw EmailAttachmentError.uploadFailed
            }
        }
        for attachment in draft.forwardedAttachments where !draft.attachedForwardIDs.contains(attachment.id) {
            try await service.forwardAttachment(attachment.id, draftID: draftID, inboxID: draft.inboxID)
            draft.attachedForwardIDs.insert(attachment.id)
        }
    }
}
