import Foundation
import Observation

struct NativeAgentPending: Codable, Identifiable, Equatable {
    var id: String
    var text: String
    var state: String = "Sending"
    var attachments: [NativeAgentPromptAttachment]? = nil
}

@MainActor @Observable
final class NativeAgentStore {
    let id: String
    private(set) var record: NativeAgentRecord?
    private(set) var bot = NativeAgentFixtures.bot
    private(set) var transcript = NativeAgentTranscript()
    private(set) var cardSummaries: [Int: ChannelAgentSummary] = [:]
    private(set) var pending: [NativeAgentPending] = []
    private(set) var queue: [NativeAgentQueuedAction] = []
    private(set) var changes: NativeAgentChanges?
    private(set) var loading = false
    private(set) var displayRevision = 0
    private(set) var connected = false
    private(set) var stopping = false
    private(set) var pendingPermissionAnswers: [WorkspaceJSON] = []
    var error: String?
    var draftAttachments: [NativeAgentPromptAttachment] = [] { didSet { persistAttachments() } }
    var draft = "" { didSet { draftStore?.setDraft(draft, channelID: "agent:" + id) } }
    @ObservationIgnored private let api: NativeAgentAPI
    @ObservationIgnored private weak var draftStore: ChatStore?
    @ObservationIgnored private var entries: [NativeAgentLogEntry] = []
    @ObservationIgnored private var socket: NativeAgentSocket?
    @ObservationIgnored private var foldTask: Task<Void, Never>?
    @ObservationIgnored private var sends: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var queueRevision = 0
    @ObservationIgnored private var logRevision = 0
    @ObservationIgnored private var latestTurnState: String?
    @ObservationIgnored private var active = false
    @ObservationIgnored private var refreshRequested = false

    init(id: String, api: NativeAgentAPI, socket: NativeAgentSocket? = nil, draftStore: ChatStore? = nil) {
        self.id = id; self.api = api; self.socket = socket; self.draftStore = draftStore
        // Observable setters invoke didSet even during initialization. Restoring
        // a view's State must not write into the observed shared draft store:
        // SwiftUI may construct this value again while evaluating its parent.
        _draft = draftStore?.drafts["agent:" + id] ?? ""
        if let encoded = draftStore?.drafts["agent-attachments:" + id], let data = encoded.data(using: .utf8) {
            _draftAttachments = (try? JSONDecoder().decode([NativeAgentPromptAttachment].self, from: data)) ?? []
        }
        if let encoded = draftStore?.drafts["agent-outbox:" + id], let data = encoded.data(using: .utf8),
           let saved = try? JSONDecoder().decode([NativeAgentPending].self, from: data) {
            pending = saved.map { var action = $0; action.state = "Failed"; return action }
        }
    }

    func start() async {
        guard !active else { return }; active = true
        socket?.start(id: id, onEvent: { [weak self] in self?.receive($0) }, onConnected: { [weak self] in
            guard let self else { return }; connected = true
            Task { await self.refresh() }
        })
        await refresh()
    }

    func retryLoad() async { if active { await refresh() } else { await start() } }

    func stopObserving() { active = false; socket?.stop(); connected = false; generation += 1; foldTask?.cancel(); foldTask = nil }

    func refresh() async {
        guard !loading else { refreshRequested = true; return }
        loading = true; let current = generation; let queueVersion = queueRevision; let logVersion = logRevision
        let atStart = Set(entries.map(\.id))
        defer {
            loading = false
            if refreshRequested, active {
                refreshRequested = false
                Task { await refresh() }
            }
        }
        do {
            async let session = api.record(id)
            async let history = api.log(id)
            async let queued = api.queue(id)
            let (record, log, actions) = try await (session, history, queued)
            guard current == generation else { return }
            self.record = record; bot = log.bot
            // Preserve socket overlap at or after the snapshot's inclusive history
            // boundary. A lagging read must not retract already-persisted live rows;
            // compacted rows before the new boundary are obsolete.
            let snapshotIDs = Set(log.entries.map(\.id))
            let boundary = log.entries.first
            let buffered = entries.filter { row in
                guard !snapshotIDs.contains(row.id) else { return false }
                if let boundary { return !Self.less(row, boundary) }
                return !atStart.contains(row.id)
            }
            entries = (log.entries + buffered).sorted(by: Self.less)
            if queueVersion == queueRevision { queue = actions }
            if logVersion == logRevision { latestTurnState = nil }
            await refold(); error = nil
            if record.isCoding { await refreshChanges() }
        } catch is CancellationError { }
        catch {
            guard current == generation else { return }
            if case NativeSessionError.requestFailed(let status) = error, status == 403 || status == 404 {
                invalidateAccess()
            }
            self.error = error.localizedDescription
        }
    }

    @discardableResult func send() -> String? {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty || !draftAttachments.isEmpty, record?.canEdit == true else { return nil }
        let action = NativeAgentPending(id: MessageID.new(), text: text, attachments: draftAttachments.isEmpty ? nil : draftAttachments)
        pending.append(action); draft = ""; draftAttachments = []; persistOutbox(); deliver(action); return action.id
    }

    func retry(_ action: NativeAgentPending) {
        guard record?.canEdit == true, action.state == "Failed", sends[action.id] == nil else { return }
        if let index = pending.firstIndex(where: { $0.id == action.id }) { pending[index].state = "Sending" }
        deliver(action)
    }

    func refreshChanges() async {
        let current = generation
        do {
            let value = try await api.changes(id)
            if current == generation { changes = value }
        } catch { /* Changes are optional; transcript access remains independent. */ }
    }

    func loadPatch() async throws -> String {
        let current = generation
        guard record != nil else { throw NativeSessionError.requestFailed(403) }
        let value = try await api.patch(id)
        guard current == generation, record != nil else { throw CancellationError() }
        return value
    }

    func changeModel(_ model: String) async {
        guard record?.canEdit == true else { return }
        do { try await api.setModel(model, sessionID: id); await refresh() }
        catch { self.error = error.localizedDescription }
    }

    func stopAgent() async {
        guard record?.canEdit == true, !stopping else { return }
        stopping = true
        do { try await api.stop(id); await refresh() }
        catch { stopping = false; self.error = error.localizedDescription }
    }

    func answer(_ permission: NativeAgentPermission, optionID: String) async {
        guard record?.canEdit == true, !permission.answered, !pendingPermissionAnswers.contains(permission.requestID) else { return }
        pendingPermissionAnswers.append(permission.requestID)
        do { try await api.answer(permission, optionID: optionID, sessionID: id); await refresh() }
        catch { pendingPermissionAnswers.removeAll { $0 == permission.requestID }; self.error = error.localizedDescription }
    }

    private func deliver(_ action: NativeAgentPending) {
        sends[action.id] = Task { [weak self] in
            guard let self else { return }
            defer { sends[action.id] = nil; persistOutbox() }
            do {
                let result = try await api.prompt(action.text, sessionID: id, actionID: action.id, attachments: action.attachments ?? [])
                if let index = pending.firstIndex(where: { $0.id == action.id }) { pending[index].state = result.status == "queued" ? "Queued" : "Sent" }
                await refresh()
            } catch {
                if case NativeSessionError.requestFailed(let status) = error, status == 403 || status == 404 { invalidateAccess() }
                if let index = pending.firstIndex(where: { $0.id == action.id }) { pending[index].state = "Failed"; self.error = error.localizedDescription }
            }
        }
    }

    func receive(_ event: NativeAgentSocketEvent) {
        guard event.sessionID == id else { return }
        switch event.type {
        case "agent_session_log":
            logRevision += 1; latestTurnState = event.turnState
            let known = Set(entries.map(\.id))
            entries.append(contentsOf: event.entries.filter { !known.contains($0.id) })
            entries.sort(by: Self.less)
            // One update per display burst, with protocol folding off the main actor.
            if foldTask == nil {
                foldTask = Task { [weak self] in
                    try? await Task.sleep(for: .milliseconds(32))
                    guard let self, !Task.isCancelled else { return }
                    foldTask = nil; await refold()
                }
            }
        case "agent_session_queue": queueRevision += 1; queue = event.queue; displayRevision += 1; reconcilePending()
        case "agent_session_renamed": if let name = event.name { record?.name = name }
        case "agent_session_updated": Task { await refresh() }
        case "agent_session_changes": Task { await refreshChanges() }
        default: break
        }
    }

    private func refold() async {
        let snapshot = entries, current = generation
        let (value, summaries) = await Task.detached(priority: .userInitiated) {
            (NativeAgentTranscript.fold(snapshot), ChannelAgentSummary.project(snapshot))
        }.value
        guard current == generation, snapshot == entries else { return }
        transcript = value; cardSummaries = summaries; displayRevision += 1
        if let latestTurnState { transcript.applyTurnState(latestTurnState) }
        if !transcript.isWorking { stopping = false }
        pendingPermissionAnswers.removeAll { requestID in !transcript.parts.contains { $0.permission?.requestID == requestID && $0.permission?.answered == false } }
        reconcilePending()
    }

    private func reconcilePending() {
        let queuedIDs = Set(queue.map(\.id))
        pending.removeAll { transcript.promptIDs.contains($0.id) || queuedIDs.contains($0.id) }
        persistOutbox()
    }

    private func invalidateAccess() {
        generation += 1; active = false; connected = false; refreshRequested = false
        socket?.stop(); foldTask?.cancel(); foldTask = nil
        for task in sends.values { task.cancel() }; sends.removeAll()
        entries = []; transcript = NativeAgentTranscript(); cardSummaries = [:]; pending = []; queue = []; changes = nil
        record = nil; draft = ""; draftAttachments = []; pendingPermissionAnswers = []; stopping = false
        displayRevision += 1; persistOutbox()
    }

    private func persistAttachments() {
        let encoded = draftAttachments.isEmpty ? "" : (try? JSONEncoder().encode(draftAttachments)).map { String(decoding: $0, as: UTF8.self) } ?? ""
        draftStore?.setDraft(encoded, channelID: "agent-attachments:" + id)
    }

    private func persistOutbox() {
        guard let draftStore else { return }
        let encoded = pending.isEmpty ? "" : (try? JSONEncoder().encode(pending)).map { String(decoding: $0, as: UTF8.self) } ?? ""
        draftStore.setDraft(encoded, channelID: "agent-outbox:" + id)
    }

    nonisolated private static func less(_ lhs: NativeAgentLogEntry, _ rhs: NativeAgentLogEntry) -> Bool {
        if lhs.createdAt == rhs.createdAt { return lhs.id < rhs.id }
        return lhs.createdAt < rhs.createdAt
    }
}
