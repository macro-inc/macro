import Foundation
import Observation

@MainActor @Observable
final class NativeCognitionStore {
    private(set) var id: String?
    private(set) var name = "New Chat"
    private(set) var messages: [NativeCognitionMessage] = []
    var draft: String { didSet { chat.setDraft(draft, channelID: draftKey) } }
    var attachments: [NativeAgentPromptAttachment] { didSet { persistAttachments() } }
    var model = NativeCognitionAPI.models[0].id { didSet { chat.setDraft(model, channelID: draftKey + "-model") } }
    private(set) var isSending = false
    private(set) var isStreaming = false
    private(set) var canEdit = true
    private(set) var isLoading = false
    private(set) var uncertainSubmission = false
    var error: String?
    private(set) var revision = 0
    @ObservationIgnored private let chat: ChatStore
    @ObservationIgnored private let api: NativeCognitionAPI
    @ObservationIgnored private let draftKey: String
    @ObservationIgnored private let socket: NativeCognitionSocket
    @ObservationIgnored private var observing = false
    @ObservationIgnored private var replayStreams = Set<String>()
    @ObservationIgnored private var snapshotMessageIDs = Set<String>()
    @ObservationIgnored private var polling: Task<Void, Never>?
    @ObservationIgnored private var creation: Task<String, Error>?
    @ObservationIgnored private var activeStreamID: String?
    @ObservationIgnored private var activeMessageID: String?
    @ObservationIgnored private var endedStreams = Set<String>()
    @ObservationIgnored private var hasLoaded = false
    @ObservationIgnored private var pendingUserID: String?
    @ObservationIgnored private var pendingContent: String?
    @ObservationIgnored private var pendingAttachments: [NativeCognitionAttachment] = []
    @ObservationIgnored private var beforeSendIDs: Set<String> = []
    @ObservationIgnored private var queuedFrames: [WorkspaceJSON] = []
    @ObservationIgnored private var foldTask: Task<Void, Never>?
    @ObservationIgnored private var accessGeneration = UUID()
    @ObservationIgnored private var accessRevoked = false

    init(session: NativeSession, chat: ChatStore, id: String? = nil, draftKey: String = "agent-new", api: NativeCognitionAPI? = nil) {
        self.chat = chat; self.socket = NativeCognitionSocket(session: session); self.api = api ?? NativeCognitionAPI(session: session); self.draftKey = id.map { "cognition-" + $0 } ?? draftKey
        self.id = id ?? chat.drafts[draftKey + "-cognition-id"]?.nilIfEmpty
        self._draft = chat.drafts[self.draftKey] ?? ""
        self._attachments = chat.drafts[self.draftKey + "-attachments"]?.data(using: .utf8).flatMap { try? JSONDecoder().decode([NativeAgentPromptAttachment].self, from: $0) } ?? []
        if let savedModel = chat.drafts[self.draftKey + "-model"], NativeCognitionAPI.models.contains(where: { $0.id == savedModel }) { self._model = savedModel }
    }
    func start() async {
        do {
            isLoading = true; defer { isLoading = false }
            if id == nil {
                let task: Task<String, Error>
                if let creation { task = creation }
                else { task = Task { try await api.create() }; creation = task }
                id = try await task.value; creation = nil
                chat.setDraft(id ?? "", channelID: draftKey + "-cognition-id")
            }
            await refresh()
            guard !accessRevoked else { return }
            if !observing, let id {
                observing = true
                socket.start(id: id, onEvent: { [weak self] in self?.enqueue($0) }, onConnected: { [weak self] in
                    guard let self else { return }; await self.refresh(); self.beginReplay()
                })
            }
            if polling == nil {
                polling = Task { [weak self] in
                    while !Task.isCancelled {
                        do { try await Task.sleep(for: .seconds(8)) } catch { return }
                        guard let self else { return }
                        await self.refresh()
                    }
                }
            }
        } catch { creation = nil; self.error = error.localizedDescription }
    }
    func stopObserving() {
        socket.stop(); observing = false
        polling?.cancel(); polling = nil; foldTask?.cancel(); foldTask = nil
        if !queuedFrames.isEmpty { fold() }
    }
    func refresh() async {
        guard let id else { return }
        let generation = accessGeneration
        do {
            let response = try await api.get(id)
            guard generation == accessGeneration else { return }
            canEdit = ["owner", "edit"].contains(response.userAccessLevel)
            name = response.chat.name
            if !hasLoaded && chat.drafts[draftKey + "-model"]?.isEmpty != false { model = response.chat.model ?? model }; hasLoaded = true
            let remote = response.chat.messages
            snapshotMessageIDs = Set(remote.map(\.id))
            if uncertainSubmission, let content = pendingContent, remote.contains(where: { !beforeSendIDs.contains($0.id) && $0.role == "user" && $0.text == content && $0.attachments == pendingAttachments }) {
                uncertainSubmission = false; pendingContent = nil; pendingUserID = nil; draft = ""; attachments = []; error = nil
                chat.setDraft("", channelID: draftKey + "-cognition-id")
            }
            if !isStreaming || remote.contains(where: { $0.id == activeMessageID }) {
                let pending = messages.filter { pending in pending.id == pendingUserID && !remote.contains(where: { !beforeSendIDs.contains($0.id) && $0.role == "user" && $0.text == pending.text && $0.attachments == pending.attachments }) }
                messages = remote + pending
                if remote.contains(where: { $0.id == activeMessageID }) { isStreaming = false; activeStreamID = nil; activeMessageID = nil }
                revision += 1
            }
        } catch NativeSessionError.requestFailed(let status) where status == 403 || status == 404 {
            accessGeneration = UUID(); accessRevoked = true; canEdit = false; messages = []; draft = ""; attachments = []; isStreaming = false; isSending = false
            stopObserving(); error = "This conversation is no longer available."
        } catch { self.error = error.localizedDescription }
    }
    @discardableResult func send(content: String, attachments supplied: [NativeAgentPromptAttachment]) async -> Bool {
        guard canEdit, !isSending, !isStreaming, !uncertainSubmission else { return false }
        let content = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty || !supplied.isEmpty else { return false }
        if id == nil { await start() }
        guard let id, canEdit, !accessRevoked else { return false }
        let refs: [NativeCognitionAttachment]
        do { refs = try Self.references(content: content, files: supplied) }
        catch { self.error = error.localizedDescription; return false }
        isSending = true; error = nil
        let generation = accessGeneration
        beforeSendIDs = Set(messages.map(\.id)); pendingContent = content; pendingAttachments = refs
        let optimisticID = "pending-" + MessageID.new(); pendingUserID = optimisticID
        messages.append(.init(id: optimisticID, role: "user", content: .string(content), attachments: refs)); revision += 1
        defer { if generation == accessGeneration { isSending = false } }
        do {
            let result = try await api.send(content, chatID: id, model: model, attachments: refs)
            guard generation == accessGeneration else { return false }
            isStreaming = !api.isDemo && !endedStreams.contains(result.stream_id)
            activeStreamID = isStreaming ? result.stream_id : nil; activeMessageID = isStreaming ? result.message_id : nil
            draft = ""; self.attachments = []; pendingContent = nil
            chat.setDraft(model, channelID: draftKey + "-model")
            if result.chat_id != id {
                self.id = result.chat_id; chat.setDraft(result.chat_id, channelID: draftKey + "-cognition-id")
                socket.stop(); observing = false; await start()
            }
            chat.setDraft("", channelID: draftKey + "-cognition-id")
            if name == "New Chat" { name = String(MentionCodec.displayText(in: content).prefix(70)); try? await api.rename(result.chat_id, name: name) }
            if api.isDemo || !isStreaming { pendingUserID = nil; await refresh() }
            return true
        } catch {
            guard generation == accessGeneration else { return false }
            if case NativeSessionError.requestFailed(let status) = error, (400..<500).contains(status) {
                messages.removeAll { $0.id == optimisticID }; pendingUserID = nil; pendingContent = nil
                self.error = error.localizedDescription
                return false
            } else {
                uncertainSubmission = true
                self.error = "The connection ended before sending was confirmed. Check for the message before sending again."
                await refresh()
            }
            return !uncertainSubmission && pendingContent == nil && messages.contains { $0.role == "user" && $0.text == content }
        }
    }
    func stop() async {
        guard let id, let activeStreamID, canEdit else { return }
        do { try await api.stop(chatID: id, streamID: activeStreamID); isStreaming = false; self.activeStreamID = nil; activeMessageID = nil; await refresh() }
        catch { self.error = error.localizedDescription }
    }
    func answer(messageID: String, callID: String, accept: Bool) async {
        guard let id, canEdit else { return }
        do { try await api.tool(chatID: id, messageID: messageID, callID: callID, accept: accept); await refresh() }
        catch { self.error = error.localizedDescription }
    }
    func beginReplay() { replayStreams.removeAll(); queuedFrames.removeAll(); foldTask?.cancel(); foldTask = nil }
    func enqueue(_ frame: WorkspaceJSON) {
        guard frame["id"]["entity_id"].string == id else { return }
        queuedFrames.append(frame)
        guard foldTask == nil else { return }
        foldTask = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(24)) } catch { return }
            guard let self else { return }; self.foldTask = nil; self.fold()
        }
    }
    func fold() {
        let frames = queuedFrames; queuedFrames.removeAll(keepingCapacity: true)
        for frame in frames {
            let payload = frame["payload"], type = payload["type"].string
            if type == "chat_user_message", let messageID = payload["message_id"].string {
                let content = payload["content"].string ?? ""
                if let pendingUserID, pendingContent == content || messages.first(where: { $0.id == pendingUserID })?.text == content {
                    messages.removeAll { $0.id == pendingUserID }; self.pendingUserID = nil
                }
                if !messages.contains(where: { $0.id == messageID }) {
                    let refs = (try? JSONDecoder().decode([NativeCognitionAttachment].self, from: JSONEncoder().encode(payload["attachments"]))) ?? []
                    messages.append(.init(id: messageID, role: "user", content: .string(content), attachments: refs))
                }
            } else if type == "chat_message_response", let messageID = payload["message_id"].string {
                guard !snapshotMessageIDs.contains(messageID) else { continue }
                let streamID = frame["id"]["stream_id"].string ?? messageID
                if replayStreams.insert(streamID).inserted { messages.removeAll { $0.id == messageID } }
                isStreaming = true; activeStreamID = streamID; activeMessageID = messageID
                if let index = messages.firstIndex(where: { $0.id == messageID }) {
                    var parts = messages[index].parts; Self.append(payload["content"], to: &parts); messages[index].content = .array(parts)
                } else { messages.append(.init(id: messageID, role: "assistant", content: .array([payload["content"]]))) }
            } else if type == "stream_end" {
                if let ended = frame["id"]["stream_id"].string { endedStreams.insert(ended) }
                isStreaming = false; activeStreamID = nil; activeMessageID = nil
                Task { [weak self] in try? await Task.sleep(for: .milliseconds(250)); await self?.refresh() }
            } else if type == "error" || type == "chat_error" {
                isStreaming = false; error = payload.firstString("message", "error", "description") ?? "The response couldn't finish."
            }
        }
        revision += 1
    }
    nonisolated static func append(_ part: WorkspaceJSON, to parts: inout [WorkspaceJSON]) {
        let type = part["type"].string
        if let last = parts.last, last["type"].string == type, type == "text" || type == "thinking" {
            let field = type == "text" ? "text" : "thinking"
            var object = last.object ?? [:]; object[field] = .string((last[field].string ?? "") + (part[field].string ?? "")); parts[parts.count - 1] = .object(object)
        } else { parts.append(part) }
    }
    nonisolated static func references(content: String, files: [NativeAgentPromptAttachment]) throws -> [NativeCognitionAttachment] {
        var refs: [NativeCognitionAttachment] = []
        for mention in MentionCodec.mentions(in: content) {
            let type = mention.entityType == "thread" ? "email_thread" : mention.entityType
            if ["document", "channel", "email_thread", "project", "skill", "call", "agent_session", "chat", "calendar_event"].contains(type) { refs.append(.init(entity_id: mention.entityID, entity_type: type)) }
        }
        for file in files {
            guard let url = URL(string: file.uri), url.scheme == "https", ["static-file-service.macro.com", "static-file-service-dev.macro.com"].contains(url.host ?? ""), url.pathComponents.count == 3, url.pathComponents[1] == "file" else { throw WorkspaceError.invalidResponse }
            refs.append(.init(entity_id: url.lastPathComponent, entity_type: "static_file"))
        }
        var seen = Set<String>(); return refs.filter { seen.insert($0.entity_type + ":" + $0.entity_id).inserted }
    }
    private func persistAttachments() {
        chat.setDraft((try? JSONEncoder().encode(attachments)).flatMap { String(data: $0, encoding: .utf8) } ?? "", channelID: draftKey + "-attachments")
    }
}

private extension String { var nilIfEmpty: String? { isEmpty ? nil : self } }
