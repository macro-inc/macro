import Foundation
import Observation

enum DeliveryState: String, Codable { case sending, failed }

struct ChannelDraftAttachment: Codable, Identifiable, Sendable {
    var attachment: MessageAttachment
    var title: String
    var id: String { attachment.id }
}

struct ChatSnapshot: Codable {
    var channels: [Channel] = []
    var messages: [String: [ChatMessage]] = [:]
    var drafts: [String: String] = [:]
    var pending: [String: DeliveryState] = [:]
    var names: [String: String] = [:]
    var historyBoundaries: [String: [String]]? = nil
    var draftAttachments: [String: [ChannelDraftAttachment]]? = nil
    var expandedThreadIDs: Set<String> = []
}

extension ChatSnapshot {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        channels = try values.decodeIfPresent([Channel].self, forKey: .channels) ?? []
        messages = try values.decodeIfPresent([String: [ChatMessage]].self, forKey: .messages) ?? [:]
        drafts = try values.decodeIfPresent([String: String].self, forKey: .drafts) ?? [:]
        pending = try values.decodeIfPresent([String: DeliveryState].self, forKey: .pending) ?? [:]
        names = try values.decodeIfPresent([String: String].self, forKey: .names) ?? [:]
        historyBoundaries = try values.decodeIfPresent([String: [String]].self, forKey: .historyBoundaries)
        draftAttachments = try values.decodeIfPresent([String: [ChannelDraftAttachment]].self, forKey: .draftAttachments)
        expandedThreadIDs = try values.decodeIfPresent(Set<String>.self, forKey: .expandedThreadIDs) ?? []
    }
}

actor ChatDiskCache {
    private let url: URL
    private var active = true
    init(account: String) {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NativeChat", isDirectory: true)
        let safeName = Data(account.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
        url = folder.appendingPathComponent(safeName + ".json")
    }
    func read() -> ChatSnapshot? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(ChatSnapshot.self, from: data)
    }
    func write(_ snapshot: ChatSnapshot) {
        guard active else { return }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            var folder = url.deletingLastPathComponent()
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try folder.setResourceValues(values)
            let data = try JSONEncoder().encode(snapshot)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch { /* Cache is optional; the server remains the source of truth. */ }
    }
    func clear() { active = false; try? FileManager.default.removeItem(at: url) }
}

@MainActor @Observable
final class ChatStore {
    private(set) var channels: [Channel] = []
    private(set) var messages: [String: [ChatMessage]] = [:]
    private(set) var drafts: [String: String] = [:]
    private(set) var draftAttachments: [String: [ChannelDraftAttachment]] = [:]
    private(set) var pending: [String: DeliveryState] = [:]
    private(set) var deliveryErrors: [String: String] = [:]
    private(set) var names: [String: String] = [:]
    private(set) var photos: [String: URL] = [:]
    @ObservationIgnored private var requestedPhotos: Set<String> = []
    private(set) var status: SocketStatus = .disconnected
    private(set) var loadingChannels = false
    private(set) var loadingMessages: Set<String> = []
    private(set) var loadingThreads: Set<String> = []
    private(set) var threadErrors: [String: String] = [:]
    private(set) var expandedThreadIDs: Set<String> = []
    private(set) var channelError: String?
    private(set) var messageErrors: [String: String] = [:]
    private(set) var nextChannelCursor: String?
    private(set) var cursors: [String: MessageCursor] = [:]
    private(set) var selectedChannelID: String?
    private(set) var inaccessibleChannelIDs: Set<String> = []
    @ObservationIgnored private var accessDenialRevisions: [String: Int] = [:]
    let userID: String

    @ObservationIgnored private let api: any MessagingService
    @ObservationIgnored private let socket: MessagingSocket?
    @ObservationIgnored private let disk: ChatDiskCache?
    @ObservationIgnored private var sendTasks: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var loadedChannels: Set<String> = []
    @ObservationIgnored private var loadedAdditionalChannelPages = false
    @ObservationIgnored private var historyBoundaries: [String: Set<String>] = [:]
    @ObservationIgnored private var messageObservers: [UUID: (MessageEvent) -> Void] = [:]
    @ObservationIgnored private var accessObservers: [UUID: (String) -> Void] = [:]
    @ObservationIgnored private var started = false
    @ObservationIgnored private var stopped = false

    init(api: any MessagingService, userID: String, socket: MessagingSocket? = nil, cache: ChatDiskCache? = nil) {
        self.api = api; self.userID = userID; self.socket = socket; self.disk = cache
    }

    func start() async {
        guard !started else { return }
        started = true
        if let cached = await disk?.read(), !stopped {
            channels = cached.channels; messages = cached.messages; drafts = cached.drafts; names = cached.names
            draftAttachments = cached.draftAttachments ?? [:]
            expandedThreadIDs = cached.expandedThreadIDs
            // An interrupted request may have committed. Retrying keeps its original ID.
            pending = cached.pending.mapValues { _ in .failed }
            historyBoundaries = (cached.historyBoundaries ?? [:]).mapValues { Set($0) }
        }
        guard !stopped else { return }
        connect()
        await refreshChannels()
    }

    func connect() {
        guard !stopped else { return }
        guard let socket else { status = .connected; return }
        socket.start(channelID: selectedChannelID, onEvent: { [weak self] event in
            self?.receive(event)
        }, onStatus: { [weak self] status in
            guard let self else { return }
            let recovering = self.status != .connected
            self.status = status
            if status == .connected && recovering {
                Task {
                    await self.refreshChannels()
                    if let id = self.selectedChannelID { await self.loadLatest(id) }
                }
            }
        })
    }

    func suspend() { socket?.stop(); status = .disconnected; persist(immediately: true) }
    func resume() {
        guard started, !stopped else { return }
        connect()
        Task {
            await refreshChannels()
            if let id = selectedChannelID { await loadLatest(id) }
        }
    }

    func shutDown() async {
        stopped = true; socket?.stop(); saveTask?.cancel()
        sendTasks.values.forEach { $0.cancel() }; sendTasks.removeAll()
        await disk?.clear()
        inaccessibleChannelIDs = []; accessDenialRevisions = [:]
        expandedThreadIDs = []
        channels = []; messages = [:]; drafts = [:]; draftAttachments = [:]; pending = [:]; deliveryErrors = [:]; names = [:]; photos = [:]; requestedPhotos = []
    }

    func refreshChannels(more: Bool = false) async {
        guard !loadingChannels, !stopped else { return }
        if more && nextChannelCursor == nil { return }
        loadingChannels = true
        defer { loadingChannels = false }
        let accessAtRequest = accessDenialRevisions
        let previousPreviews = Dictionary(channels.compactMap { channel in channel.latestMessage.map { (channel.id, $0) } }, uniquingKeysWith: { _, latest in latest })
        do {
            let page = try await api.channels(cursor: more ? nextChannelCursor : nil)
            guard !stopped else { return }
            // A first page is not an authoritative inventory of every previously loaded page.
            var result = !more && page.nextCursor == nil ? [] : channels
            for var channel in page.items {
                guard accessAtRequest[channel.id, default: 0] == accessDenialRevisions[channel.id, default: 0] else { continue }
                let local = channels.first(where: { $0.id == channel.id })?.latestMessage
                var candidate = local
                if let message = messages[channel.id]?.last {
                    let canonical = ChannelPreview(messageID: message.id, content: message.content, senderID: message.senderID,
                        createdAt: message.createdAt, deletedAt: message.deletedAt, threadID: message.threadID, updatedAt: message.updatedAt)
                    if candidate == nil || previewIsNewer(canonical, than: candidate!) { candidate = canonical }
                }
                if let candidate {
                    let previous = previousPreviews[channel.id]
                    let changedWhileLoading = previous?.messageID != local?.messageID || previous?.content != local?.content
                        || previous?.updatedAt != local?.updatedAt
                    if let remote = channel.latestMessage {
                        if previewIsNewer(candidate, than: remote) { channel.latestMessage = candidate }
                    } else if pending[candidate.messageID] != nil || changedWhileLoading {
                        channel.latestMessage = candidate
                    }
                }
                if let index = result.firstIndex(where: { $0.id == channel.id }) { result[index] = channel }
                else { result.append(channel) }
            }
            channels = result.sorted { $0.date > $1.date }
            if more { loadedAdditionalChannelPages = true; nextChannelCursor = page.nextCursor }
            else if page.nextCursor == nil { loadedAdditionalChannelPages = false; nextChannelCursor = nil }
            else if !loadedAdditionalChannelPages { nextChannelCursor = page.nextCursor }
            channelError = nil
            await resolveNames(page.items.flatMap { $0.participants.map(\.userID) })
            persist()
        } catch { if !stopped { channelError = error.localizedDescription } }
    }

    func open(_ channel: Channel) async {
        selectedChannelID = channel.id
        socket?.selectChannel(channel.id)
        await loadLatest(channel.id)
    }

    func close(_ channelID: String) {
        guard selectedChannelID == channelID else { return }
        selectedChannelID = nil; socket?.selectChannel(nil)
        persist(immediately: true)
    }

    func loadLatest(_ channelID: String) async {
        guard !loadingMessages.contains(channelID), !stopped else { return }
        loadingMessages.insert(channelID)
        defer { loadingMessages.remove(channelID) }
        do {
            let existing = historyBoundaries[channelID] ?? Set((messages[channelID] ?? []).filter { pending[$0.id] == nil }.map(\.id))
            let initializingCursor = !loadedChannels.contains(channelID)
            var page = try await api.messages(channelID: channelID, cursor: nil)
            guard !stopped else { return }
            inaccessibleChannelIDs.remove(channelID)
            var fetched = page.items
            // Show the newest page as soon as it arrives, even when a long offline gap
            // requires several older requests. A later failure keeps this usable page.
            merge(page.items, channelID: channelID)
            if initializingCursor { cursors[channelID] = page.nextCursor; loadedChannels.insert(channelID) }
            historyBoundaries[channelID] = page.nextCursor != nil && !existing.isEmpty
                && !fetched.contains(where: { existing.contains($0.id) }) ? existing : nil
            messageErrors[channelID] = nil
            persist()
            // Bridge any messages missed while offline before joining cached history.
            while !existing.isEmpty && !fetched.contains(where: { existing.contains($0.id) }), let cursor = page.nextCursor {
                try Task.checkCancellation()
                let next = try await api.messages(channelID: channelID, cursor: cursor)
                let repeatedCursor = next.nextCursor == page.nextCursor
                page = next; fetched.append(contentsOf: page.items)
                guard !stopped else { return }
                merge(page.items, channelID: channelID)
                if initializingCursor || cursors[channelID] == cursor { cursors[channelID] = page.nextCursor }
                historyBoundaries[channelID] = page.nextCursor != nil
                    && !fetched.contains(where: { existing.contains($0.id) }) ? existing : nil
                persist()
                if repeatedCursor { break }
            }
            guard !stopped else { return }
            messageErrors[channelID] = nil
            await resolveNames(fetched.map(\.senderID))
            await hydrateThreads(channelID)
            persist()
        } catch is CancellationError { }
        catch {
            if !stopped {
                if case MessagingError.http(let status) = error, status == 403 || status == 404 { removeInaccessibleChannel(channelID) }
                messageErrors[channelID] = error.localizedDescription
            }
        }
    }

    func loadOlder(_ channelID: String) async {
        guard let cursor = cursors[channelID], !loadingMessages.contains(channelID), !stopped else { return }
        loadingMessages.insert(channelID)
        defer { loadingMessages.remove(channelID) }
        do {
            let page = try await api.messages(channelID: channelID, cursor: cursor)
            guard !stopped else { return }
            merge(page.items, channelID: channelID); cursors[channelID] = page.nextCursor
            messageErrors[channelID] = nil
            await resolveNames(page.items.map(\.senderID)); persist()
        } catch {
            if !stopped {
                if case MessagingError.http(let status) = error, status == 403 || status == 404 { removeInaccessibleChannel(channelID) }
                messageErrors[channelID] = error.localizedDescription
            }
        }
    }

    private func previewIsNewer(_ candidate: ChannelPreview, than previous: ChannelPreview) -> Bool {
        if candidate.messageID == previous.messageID {
            return MessageDate.parse(candidate.updatedAt ?? candidate.createdAt) > MessageDate.parse(previous.updatedAt ?? previous.createdAt)
        }
        return MessageDate.parse(candidate.createdAt) > MessageDate.parse(previous.createdAt)
    }

    private func removeInaccessibleChannel(_ channelID: String) {
        inaccessibleChannelIDs.insert(channelID)
        accessDenialRevisions[channelID, default: 0] += 1
        channels.removeAll { $0.id == channelID }
        expandedThreadIDs.subtract((messages[channelID] ?? []).map(\.id))
        for message in (messages[channelID] ?? []).flatMap({ [$0] + ($0.thread?.preview ?? []) }) {
            sendTasks[message.id]?.cancel()
            sendTasks[message.id] = nil
            pending[message.id] = nil
            deliveryErrors[message.id] = nil
        }
        messages[channelID] = nil
        for key in drafts.keys.filter({ $0 == channelID || $0.hasPrefix("thread:\(channelID):") || $0.hasPrefix("thread-outbox:\(channelID):") || $0.hasPrefix("reply-target:\(channelID):") }) { drafts[key] = nil }
        for key in draftAttachments.keys.filter({ $0 == channelID || $0.hasPrefix("thread:\(channelID):") || $0.hasPrefix("thread-outbox:\(channelID):") || $0.hasPrefix("reply-target:\(channelID):") }) { draftAttachments[key] = nil }
        cursors[channelID] = nil
        loadedChannels.remove(channelID)
        historyBoundaries[channelID] = nil
        close(channelID)
        for observer in Array(accessObservers.values) { observer(channelID) }
        persist(immediately: true)
    }

    func isChannelInaccessible(_ channelID: String) -> Bool {
        inaccessibleChannelIDs.contains(channelID)
    }

    func canCompose(in channel: Channel) -> Bool {
        !stopped && !isChannelInaccessible(channel.id)
            && (channels.first(where: { $0.id == channel.id }) ?? channel).isParticipant
    }

    private func isInaccessibleDraftKey(_ key: String) -> Bool {
        inaccessibleChannelIDs.contains { key == $0 || key.hasPrefix("thread:\($0):") || key.hasPrefix("thread-outbox:\($0):") || key.hasPrefix("reply-target:\($0):") }
    }

    func setDraft(_ value: String, channelID: String) {
        guard !stopped, !isInaccessibleDraftKey(channelID) else { return }
        drafts[channelID] = value; persist()
    }

    func setDraftAttachments(_ attachments: [ChannelDraftAttachment], channelID: String) {
        guard !stopped, !isInaccessibleDraftKey(channelID) else { return }
        draftAttachments[channelID] = attachments; persist()
    }

    @discardableResult
    func send(_ content: String, channelID: String, attachments: [MessageAttachment] = [], threadID: String? = nil) -> String? {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (!trimmed.isEmpty || !attachments.isEmpty), !stopped, !inaccessibleChannelIDs.contains(channelID) else { return nil }
        if let threadID, messages[channelID]?.contains(where: { $0.id == threadID }) != true { return nil }
        let id = MessageID.new()
        let date = MessageDate.string(Date())
        let message = ChatMessage(id: id, parent: MessageParent(id: channelID), senderID: userID,
                                  content: trimmed, createdAt: date, updatedAt: date, threadID: threadID, attachments: attachments, nonce: id)
        if threadID != nil { mergeReply(message, channelID: channelID, confirmed: false) }
        else { messages[channelID, default: []].append(message) }
        let draftKey = threadID.map { "thread:\(channelID):\($0)" } ?? channelID
        pending[id] = .sending; drafts[draftKey] = ""
        if let threadID { drafts["reply-target:\(channelID):\(threadID)"] = nil }
        draftAttachments[draftKey] = nil
        updatePreview(message)
        persist(immediately: true)
        deliver(message)
        return id
    }

    func retry(_ message: ChatMessage) {
        guard pending[message.id] == .failed, sendTasks[message.id] == nil else { return }
        pending[message.id] = .sending
        deliveryErrors[message.id] = nil
        deliver(message)
    }

    private func deliver(_ message: ChatMessage) {
        sendTasks[message.id] = Task { [weak self] in
            guard let self else { return }
            defer { self.sendTasks[message.id] = nil }
            do {
                var confirmed = try await self.api.send(channelID: message.channelID, content: message.content, nonce: message.id, attachments: message.attachments, threadID: message.threadID)
                guard !self.stopped, !Task.isCancelled else { return }
                if confirmed.nonce == nil { confirmed.nonce = message.id }
                self.merge([confirmed], channelID: message.channelID)
                self.pending[message.id] = nil
                self.deliveryErrors[message.id] = nil
                self.updatePreview(confirmed)
            } catch {
                guard !self.stopped else { return }
                // A websocket acknowledgement can arrive before a failed HTTP response.
                if self.pending[message.id] != nil {
                    self.pending[message.id] = .failed
                    self.deliveryErrors[message.id] = error.localizedDescription
                }
            }
            self.persist(immediately: true)
        }
    }

    func receive(_ event: MessageEvent) {
        guard event.parent.type == "channel", !stopped, !inaccessibleChannelIDs.contains(event.channelID) else { return }
        for observer in messageObservers.values { observer(event) }
        if var message = event.change.message {
            if message.nonce == nil { message.nonce = event.nonce }
            if message.threadID == nil {
                merge([message], channelID: event.channelID)
                updatePreview(message)
            } else {
                mergeReply(message, channelID: event.channelID)
                updatePreview(message)
                if let rootID = message.threadID, messages[event.channelID]?.contains(where: { $0.id == rootID }) != true,
                   selectedChannelID == event.channelID { Task { await loadLatest(event.channelID) } }
            }
            Task { await resolveNames([message.senderID]) }
        } else if selectedChannelID == event.channelID && event.change.type != "typing" {
            Task { await loadLatest(event.channelID) }
        }
        persist()
    }

    func observeMessages(_ observer: @escaping (MessageEvent) -> Void) -> UUID {
        let id = UUID(); messageObservers[id] = observer; return id
    }

    func removeMessageObserver(_ id: UUID) { messageObservers[id] = nil }

    func observeChannelAccessDenial(_ observer: @escaping (String) -> Void) -> UUID {
        let id = UUID(); accessObservers[id] = observer; return id
    }
    func removeChannelAccessObserver(_ id: UUID) { accessObservers[id] = nil }

    func clearThreadData(channelID: String, rootID: String) {
        expandedThreadIDs.remove(rootID)
        for reply in messages[channelID]?.first(where: { $0.id == rootID })?.thread?.preview ?? [] {
            sendTasks[reply.id]?.cancel(); sendTasks[reply.id] = nil
            pending[reply.id] = nil; deliveryErrors[reply.id] = nil
        }
        drafts["thread:\(channelID):\(rootID)"] = nil
        drafts["thread-outbox:\(channelID):\(rootID)"] = nil
        drafts["reply-target:\(channelID):\(rootID)"] = nil
        draftAttachments["thread:\(channelID):\(rootID)"] = nil
        messages[channelID]?.removeAll { $0.id == rootID || $0.threadID == rootID }
        if let index = channels.firstIndex(where: { $0.id == channelID && ($0.latestMessage?.messageID == rootID || $0.latestMessage?.threadID == rootID) }) {
            channels[index].latestMessage = nil
        }
        persist(immediately: true)
    }


    func markViewed(channelID: String, at timestamp: String) {
        guard let index = channels.firstIndex(where: { $0.id == channelID }),
              MessageDate.parse(timestamp) > MessageDate.parse(channels[index].viewedAt ?? "") else { return }
        channels[index].viewedAt = timestamp; persist()
    }

    func insertCreatedChannel(_ channel: Channel) {
        if let index = channels.firstIndex(where: { $0.id == channel.id }) { channels[index] = channel }
        else { channels.insert(channel, at: 0) }
        persist()
    }

    private func merge(_ incoming: [ChatMessage], channelID: String) {
        // Live traffic is normally one message. Avoid sorting the whole conversation
        // for every edit, reaction, acknowledgement, or incoming message.
        if incoming.count == 1, let message = incoming.first {
            mergeOne(message, channelID: channelID)
            return
        }
        var byID = Dictionary((messages[channelID] ?? []).map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        for message in incoming where message.threadID == nil {
            var optimisticPrevious: ChatMessage?
            // Older deployed servers may allocate their own ID and echo our nonce.
            if message.senderID == userID, let nonce = message.nonce, nonce != message.id {
                optimisticPrevious = byID[nonce]
                byID[nonce] = nil
                pending[nonce] = nil
                deliveryErrors[nonce] = nil
            }
            // Server acknowledgements replace optimistic timestamps even when the device clock is ahead.
            // Confirmed records still reject history older than a live edit/delete.
            if pending[message.id] == nil, let previous = byID[message.id],
               MessageDate.parse(previous.updatedAt) > MessageDate.parse(message.updatedAt) { continue }
            let merged = preservingMetadata(message, previous: byID[message.id] ?? optimisticPrevious)
            byID[message.id] = merged
            pending[message.id] = nil
            deliveryErrors[message.id] = nil
        }
        // Parse once per record, rather than for every comparison on the main actor.
        let datedMessages: [(message: ChatMessage, date: Date)] = byID.values.map { ($0, $0.date) }
        let sorted = datedMessages.sorted { a, b in
            a.date == b.date ? a.message.id < b.message.id : a.date < b.date
        }
        messages[channelID] = sorted.map { $0.message }
        for reply in incoming where reply.threadID != nil { mergeReply(reply, channelID: channelID) }
    }

    private func mergeOne(_ message: ChatMessage, channelID: String) {
        guard message.threadID == nil else { mergeReply(message, channelID: channelID); return }
        var timeline = messages[channelID] ?? []
        var optimisticPrevious: ChatMessage?
        if message.senderID == userID, let nonce = message.nonce, nonce != message.id {
            optimisticPrevious = timeline.first { $0.id == nonce }
            timeline.removeAll { $0.id == nonce }
            pending[nonce] = nil; deliveryErrors[nonce] = nil
        }
        let existingIndex = timeline.firstIndex { $0.id == message.id }
        let previous = existingIndex.map { timeline[$0] }
        if pending[message.id] == nil, let previous,
           MessageDate.parse(previous.updatedAt) > MessageDate.parse(message.updatedAt) { return }
        let merged = preservingMetadata(message, previous: previous ?? optimisticPrevious)
        if let existingIndex, previous?.createdAt == message.createdAt {
            timeline[existingIndex] = merged
        } else {
            if let existingIndex { timeline.remove(at: existingIndex) }
            let date = merged.date
            if let last = timeline.last, date > last.date || (date == last.date && merged.id > last.id) {
                timeline.append(merged)
            } else {
                var low = 0, high = timeline.count
                while low < high {
                    let mid = (low + high) / 2
                    let other = timeline[mid]
                    if other.date < date || (other.date == date && other.id < merged.id) { low = mid + 1 }
                    else { high = mid }
                }
                timeline.insert(merged, at: low)
            }
        }
        pending[message.id] = nil; deliveryErrors[message.id] = nil
        messages[channelID] = timeline
    }

    private func preservingMetadata(_ message: ChatMessage, previous: ChatMessage?) -> ChatMessage {
        guard let previous else { return message }
        var merged = message
        // Single-message responses and live changes omit timeline metadata.
        merged.thread = message.thread ?? previous.thread
        if let current = message.thread, let cached = previous.thread {
            let replies = mergeReplies(current.preview, previous: cached.preview)
            merged.thread = MessageThreadPreview(replyCount: max(current.replyCount, cached.replyCount, replies.count),
                preview: replies, latestReplyAt: [current.latestReplyAt, cached.latestReplyAt].compactMap { $0 }.max())
        }
        merged.state = message.state ?? previous.state
        if message.isPartial == true {
            // Legacy echoes must not erase the modern event's full metadata.
            merged.attachments = previous.attachments
            merged.reactions = previous.reactions
            merged.mentions = previous.mentions
            merged.sender = message.sender ?? previous.sender
            merged.botProfile = message.botProfile ?? previous.botProfile
            merged.isPartial = previous.isPartial
        }
        return merged
    }

    private func mergeReplies(_ incoming: [ChatMessage], previous: [ChatMessage]) -> [ChatMessage] {
        var byID = Dictionary(previous.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        for reply in incoming {
            let replacingOptimistic = pending[reply.id] != nil || reply.nonce.map { pending[$0] != nil } == true
            var old = byID[reply.id]
            if reply.senderID == userID, let nonce = reply.nonce, nonce != reply.id {
                old = old ?? byID[nonce]; byID[nonce] = nil; pending[nonce] = nil; deliveryErrors[nonce] = nil
            }
            if !replacingOptimistic, let old, MessageDate.parse(old.updatedAt) > MessageDate.parse(reply.updatedAt) { continue }
            byID[reply.id] = preservingMetadata(reply, previous: old)
        }
        return byID.values.sorted { $0.date == $1.date ? $0.id < $1.id : $0.date < $1.date }
    }

    private func mergeReply(_ reply: ChatMessage, channelID: String, confirmed: Bool = true) {
        guard let rootID = reply.threadID, let index = messages[channelID]?.firstIndex(where: { $0.id == rootID }) else { return }
        var root = messages[channelID]![index]
        let before = root.thread ?? MessageThreadPreview()
        let alreadyCounted = before.preview.contains { $0.id == reply.id || (reply.nonce != nil && $0.id == reply.nonce) }
        let optimistic = before.preview.first { pending[$0.id] != nil && ($0.id == reply.id || $0.id == reply.nonce) }
        var previousLatest = before.latestReplyAt
        if confirmed, let optimistic, previousLatest == optimistic.createdAt {
            previousLatest = before.preview.filter { $0.id != optimistic.id }.map(\.createdAt).max()
        }
        let replies = mergeReplies([reply], previous: before.preview)
        let newerThanSummary = reply.date > MessageDate.parse(before.latestReplyAt ?? "")
        let increment = !alreadyCounted && newerThanSummary ? 1 : 0
        root.thread = MessageThreadPreview(replyCount: max(before.replyCount + increment, replies.count), preview: replies,
            latestReplyAt: [previousLatest, reply.createdAt].compactMap { $0 }.max())
        messages[channelID]![index] = root
        if confirmed { pending[reply.id] = nil; deliveryErrors[reply.id] = nil }
    }

    func mergeThread(_ thread: ChannelThread, channelID: String) {
        guard !stopped, !isChannelInaccessible(channelID) else { return }
        let cached = messages[channelID]?.first { $0.id == thread.root.id }
        var root = thread.root
        if let cached, MessageDate.parse(cached.updatedAt) > MessageDate.parse(root.updatedAt) { root = cached }
        root.thread = MessageThreadPreview(replyCount: thread.replies.count, preview: thread.replies,
            latestReplyAt: thread.replies.map(\.createdAt).max())
        root.state = thread.state
        mergeOne(root, channelID: channelID)
        for reply in thread.replies {
            pending[reply.id] = nil; deliveryErrors[reply.id] = nil
            if reply.senderID == userID, let nonce = reply.nonce { pending[nonce] = nil; deliveryErrors[nonce] = nil }
        }
        persist()
    }

    func loadThread(channelID: String, rootID: String) async {
        guard !stopped, !isChannelInaccessible(channelID), !loadingThreads.contains(rootID) else { return }
        let revision = accessDenialRevisions[channelID, default: 0]
        loadingThreads.insert(rootID); defer { loadingThreads.remove(rootID) }
        do {
            let thread = try await api.thread(channelID: channelID, rootID: rootID)
            guard !stopped, revision == accessDenialRevisions[channelID, default: 0] else { return }
            mergeThread(thread, channelID: channelID); threadErrors[rootID] = nil
            await resolveNames([thread.root.senderID] + thread.replies.map(\.senderID))
        } catch {
            guard !stopped, revision == accessDenialRevisions[channelID, default: 0] else { return }
            if case MessagingError.http(let status) = error, status == 403 || status == 404 { clearThreadData(channelID: channelID, rootID: rootID) }
            threadErrors[rootID] = error.localizedDescription
        }
    }

    /// Resolve notification/search anchors directly, including messages outside the loaded page.
    func loadTarget(channelID: String, messageID: String, threadID: String? = nil) async -> String? {
        guard !stopped, !isChannelInaccessible(channelID) else { return nil }
        do {
            let cached = (messages[channelID] ?? []).flatMap { [$0] + ($0.thread?.preview ?? []) }.first { $0.id == messageID }
            let message: ChatMessage
            if let cached { message = cached }
            else { message = try await api.getMessage(channelID: channelID, messageID: messageID) }
            guard message.channelID == channelID, !stopped else { return nil }
            let rootID = message.threadID ?? threadID
            if let rootID {
                await loadThread(channelID: channelID, rootID: rootID)
                expandThread(rootID: rootID)
            } else {
                mergeOne(message, channelID: channelID)
                if message.replyCount > 0 { await loadThread(channelID: channelID, rootID: message.id); expandThread(rootID: message.id) }
            }
            await resolveNames([message.senderID])
            persist()
            return message.id
        } catch {
            messageErrors[channelID] = "Couldn’t open that message. " + error.localizedDescription
            return nil
        }
    }

    func expandThread(rootID: String) {
        guard !stopped, messages.values.contains(where: { $0.contains(where: { $0.id == rootID && $0.threadID == nil }) }),
              expandedThreadIDs.insert(rootID).inserted else { return }
        persist(immediately: true)
    }

    private func hydrateThreads(_ channelID: String) async {
        let roots = (messages[channelID] ?? []).filter { root in
            guard let thread = root.thread else { return false }
            return thread.replyCount > thread.preview.count
                || MessageDate.parse(thread.latestReplyAt ?? "") > (thread.preview.map(\.date).max() ?? .distantPast)
        }.map(\.id)
        for start in stride(from: 0, to: roots.count, by: 4) {
            await withTaskGroup(of: Void.self) { group in
                for rootID in roots[start..<min(start + 4, roots.count)] {
                    group.addTask { await self.loadThread(channelID: channelID, rootID: rootID) }
                }
            }
        }
    }

    private func updatePreview(_ incoming: ChatMessage) {
        // A delayed echo may have been rejected by merge after a newer live edit.
        let timeline = messages[incoming.channelID] ?? []
        let reply = incoming.threadID.flatMap { rootID in timeline.first { $0.id == rootID }?.thread?.preview.first { $0.id == incoming.id } }
        let message = reply ?? timeline.first(where: { $0.id == incoming.id }) ?? incoming
        guard let index = channels.firstIndex(where: { $0.id == message.channelID }) else { return }
        if channels[index].latestMessage?.messageID == message.id
            || (message.nonce != nil && channels[index].latestMessage?.messageID == message.nonce)
            || message.date >= channels[index].date {
            channels[index].latestMessage = ChannelPreview(messageID: message.id, content: message.content,
                senderID: message.senderID, createdAt: message.createdAt, deletedAt: message.deletedAt,
                threadID: message.threadID, updatedAt: message.updatedAt)
            channels.sort { $0.date > $1.date }
        }
    }

    func name(for user: String) -> String {
        if let name = names[user] { return name }
        if user == userID { return "You" }
        return names[user] ?? user.replacingOccurrences(of: "macro|", with: "").components(separatedBy: "@").first ?? "Teammate"
    }

    func title(for channel: Channel) -> String {
        if let name = channel.name, !name.isEmpty { return name }
        let others = channel.participants.filter { $0.userID != userID }.map { name(for: $0.userID) }
        return others.isEmpty ? "Personal conversation" : others.joined(separator: ", ")
    }

    private func resolveNames(_ ids: [String]) async {
        let unique = Set(ids)
        let missing = Array(unique.filter { names[$0] == nil })
        let missingPhotos = Array(unique.subtracting(requestedPhotos))
        requestedPhotos.formUnion(missingPhotos)
        async let nameResult = missing.isEmpty ? [:] : (try? api.userNames(userIDs: missing)) ?? [:]
        async let photoResult = missingPhotos.isEmpty ? [:] : (try? api.userPhotos(userIDs: missingPhotos)) ?? [:]
        let (resolved, pictures) = await (nameResult, photoResult)
        guard !stopped else { return }
        names.merge(resolved, uniquingKeysWith: { _, new in new })
        photos.merge(pictures, uniquingKeysWith: { _, new in new })
    }

    private func persist(immediately: Bool = false) {
        guard disk != nil, !stopped else { return }
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            if !immediately { try? await Task.sleep(for: .milliseconds(350)) }
            guard !Task.isCancelled, let self, !self.stopped else { return }
            let retained = self.messages.mapValues { history in
                let recent = Array(history.suffix(300))
                let olderPending = history.dropLast(min(300, history.count)).filter { self.pending[$0.id] != nil || ($0.thread?.preview ?? []).contains { self.pending[$0.id] != nil } }
                return olderPending + recent
            }
            let snapshot = ChatSnapshot(channels: self.channels, messages: retained,
                drafts: self.drafts, pending: self.pending, names: self.names,
                historyBoundaries: self.historyBoundaries.mapValues { Array($0) }, draftAttachments: self.draftAttachments,
                expandedThreadIDs: self.expandedThreadIDs)
            await self.disk?.write(snapshot)
        }
    }
}
