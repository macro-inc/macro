import Foundation
import Observation

@MainActor @Observable
final class NativeThreadStore {
    private(set) var root: ChatMessage?
    private(set) var isInaccessible = false
    private let rootID: String
    private(set) var replies: [ChatMessage] = []
    private(set) var pending: [String: DeliveryState] = [:]
    private(set) var errors: [String: String] = [:]
    private(set) var loading = false
    private(set) var error: String?
    var draft: String { didSet { if !isInaccessible { chat.setDraft(draft, channelID: draftKey) } } }
    let channelID: String
    @ObservationIgnored private let actions: ChatActions
    @ObservationIgnored private let chat: ChatStore
    @ObservationIgnored private var observer: UUID?
    @ObservationIgnored private var accessObserver: UUID?
    @ObservationIgnored private var accessRevision = 0
    @ObservationIgnored private var sends: [String: Task<Void, Never>] = [:]
    private var draftKey: String { "thread:\(channelID):\(rootID)" }
    private var outboxKey: String { "thread-outbox:\(channelID):\(rootID)" }

    init(actions: ChatActions, chat: ChatStore, parent: ChatMessage) {
        self.actions = actions; self.chat = chat; root = parent; rootID = parent.id; channelID = parent.channelID
        draft = chat.drafts["thread:\(parent.channelID):\(parent.id)"] ?? ""
        replies = parent.thread?.preview ?? []
        actions.seedDemo(parent)
        if let value = chat.drafts[outboxKey], let data = value.data(using: .utf8),
           let saved = try? JSONDecoder().decode([ChatMessage].self, from: data) {
            replies.append(contentsOf: saved.filter { candidate in !replies.contains { $0.id == candidate.id } })
            pending = Dictionary(saved.map { ($0.id, .failed) }, uniquingKeysWith: { _, latest in latest })
        }
    }

    func start() async {
        if observer == nil { observer = chat.observeMessages { [weak self] in self?.receive($0) } }
        if accessObserver == nil {
            accessObserver = chat.observeChannelAccessDenial { [weak self] id in
                guard let self, id == self.channelID else { return }; self.clearInaccessibleData()
            }
        }
        if chat.inaccessibleChannelIDs.contains(channelID) { clearInaccessibleData() }
        await refresh()
    }

    func stop() {
        if let observer { chat.removeMessageObserver(observer); self.observer = nil }
        if let accessObserver { chat.removeChannelAccessObserver(accessObserver); self.accessObserver = nil }
        persistOutbox()
    }

    func refresh() async {
        guard !loading else { return }
        let expectedRevision = accessRevision
        loading = true; defer { loading = false }
        do {
            let thread = try await actions.thread(channelID: channelID, rootID: rootID)
            guard accessRevision == expectedRevision else { return }
            isInaccessible = false
            chat.mergeThread(thread, channelID: channelID)
            merge(thread.root)
            for message in thread.replies { merge(message) }
            error = nil
            persistOutbox()
        } catch is CancellationError { }
        catch {
            if case MessagingError.http(let status) = error, status == 403 || status == 404 { clearInaccessibleData() }
            self.error = error.localizedDescription
        }
    }

    @discardableResult func send() -> String? {
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isInaccessible, !content.isEmpty else { return nil }
        let id = MessageID.new(), now = MessageDate.string(Date())
        let message = ChatMessage(id: id, parent: MessageParent(id: channelID), senderID: actions.userID, content: content,
            createdAt: now, updatedAt: now, threadID: rootID, mentions: MentionCodec.mentions(in: content), nonce: id)
        replies.append(message); pending[id] = .sending; draft = ""
        persistOutbox(); deliver(message); return id
    }

    func retry(_ message: ChatMessage) {
        guard !isInaccessible, pending[message.id] == .failed, sends[message.id] == nil else { return }
        pending[message.id] = .sending; errors[message.id] = nil; deliver(message)
    }

    func react(_ message: ChatMessage, emoji: String) async {
        guard !isInaccessible else { return }
        let add = !(message.reactions.first { $0.emoji == emoji }?.users.contains(actions.userID) ?? false)
        do { publish(try await actions.react(message: message, emoji: emoji, add: add), type: "reacted") }
        catch { self.error = error.localizedDescription }
    }

    func edit(_ message: ChatMessage, content: String) async {
        guard !isInaccessible else { return }
        do { publish(try await actions.edit(message: message, content: content), type: "edited") }
        catch { self.error = error.localizedDescription }
    }

    func delete(_ message: ChatMessage) async {
        guard !isInaccessible else { return }
        do { publish(try await actions.delete(message: message), type: "message_deleted") }
        catch { self.error = error.localizedDescription }
    }

    private func deliver(_ message: ChatMessage) {
        sends[message.id] = Task {
            defer { sends[message.id] = nil }
            do {
                var confirmed = try await actions.reply(channelID: channelID, rootID: rootID, content: message.content, nonce: message.id)
                guard !Task.isCancelled, !isInaccessible else { return }
                if confirmed.nonce == nil { confirmed.nonce = message.id }
                publish(confirmed, type: "posted")
            } catch {
                if pending[message.id] != nil { pending[message.id] = .failed; errors[message.id] = error.localizedDescription }
            }
            persistOutbox()
        }
    }

    private func publish(_ message: ChatMessage, type: String) {
        guard !isInaccessible else { return }
        merge(message); error = nil
        chat.receive(MessageEvent(parent: message.parent, actor: message.senderID, nonce: message.nonce,
            change: MessageChange(type: type, message: message)))
    }

    private func receive(_ event: MessageEvent) {
        guard !isInaccessible, event.channelID == channelID else { return }
        if var message = event.change.message, message.id == rootID || message.threadID == rootID {
            if message.nonce == nil { message.nonce = event.nonce }
            merge(message); persistOutbox()
        } else if event.change.state?.rootID == rootID {
            root?.state = event.change.state
        }
    }

    private func merge(_ incoming: ChatMessage) {
        if incoming.id == rootID {
            if root == nil || MessageDate.parse(incoming.updatedAt) >= MessageDate.parse(root?.updatedAt ?? "") {
                var message = incoming; message.thread = incoming.thread ?? root?.thread; message.state = incoming.state ?? root?.state
                if incoming.isPartial == true, let previous = root {
                    message.attachments = previous.attachments; message.reactions = previous.reactions
                    message.mentions = previous.mentions; message.isPartial = previous.isPartial
                }
                root = message
            }
            return
        }
        guard incoming.threadID == rootID else { return }
        if incoming.senderID == actions.userID, let nonce = incoming.nonce, nonce != incoming.id {
            replies.removeAll { $0.id == nonce }; pending[nonce] = nil; errors[nonce] = nil
        }
        let index = replies.firstIndex { $0.id == incoming.id }
        if let index, pending[incoming.id] == nil,
           MessageDate.parse(replies[index].updatedAt) > MessageDate.parse(incoming.updatedAt) { return }
        var message = incoming
        if let index, incoming.isPartial == true {
            message.attachments = replies[index].attachments; message.mentions = replies[index].mentions
            message.reactions = replies[index].reactions; message.isPartial = replies[index].isPartial
        }
        if let index { replies[index] = message } else { replies.append(message) }
        pending[incoming.id] = nil; errors[incoming.id] = nil
        replies.sort { $0.date == $1.date ? $0.id < $1.id : $0.date < $1.date }
    }

    private func clearInaccessibleData() {
        accessRevision += 1; isInaccessible = true
        sends.values.forEach { $0.cancel() }; sends.removeAll()
        root = nil; replies = []; pending = [:]; errors = [:]; draft = ""
        chat.clearThreadData(channelID: channelID, rootID: rootID)
        error = MessagingError.http(403).localizedDescription
    }

    private func persistOutbox() {
        guard !isInaccessible else { return }
        let unsent = replies.filter { pending[$0.id] != nil }
        let serialized = (try? JSONEncoder().encode(unsent)).map { String(decoding: $0, as: UTF8.self) } ?? "[]"
        chat.setDraft(serialized, channelID: outboxKey)
    }
}
