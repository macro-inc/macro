import Foundation

@MainActor
final class NativeAgentAPI {
    typealias Request = @MainActor (URLRequest) async throws -> Data
    static let macroBotID = "00000000-0000-0000-0000-00000000a1a1"
    let isDemo: Bool
    private let baseURL: URL
    private let requestData: Request
    private var demoRecords: [String: NativeAgentRecord] = [:]
    private var demoEntries: [String: [NativeAgentLogEntry]] = [:]
    private struct CreationDraft { let prompt: String; let attachments: [NativeAgentPromptAttachment] }
    private var creationDrafts: [String: CreationDraft] = [:]

    convenience init(session: NativeSession) {
        self.init(baseURL: session.environment.gatewayURL, isDemo: session.isDemo) { try await session.authenticatedData(for: $0) }
    }

    init(baseURL: URL, isDemo: Bool = false, request: @escaping Request) {
        self.baseURL = baseURL; self.isDemo = isDemo; requestData = request
    }

    func record(_ id: String) async throws -> NativeAgentRecord {
        if isDemo { return demoRecords[id] ?? NativeAgentFixtures.record(id) }
        return try await decode(try await request("agent-sessions/" + id))
    }

    func log(_ id: String) async throws -> NativeAgentLog {
        if isDemo { return NativeAgentLog(bot: NativeAgentFixtures.bot, entries: demoEntries[id] ?? NativeAgentFixtures.entries) }
        return try await decode(try await request("agent-sessions/\(id)/log"))
    }

    func queue(_ id: String) async throws -> [NativeAgentQueuedAction] {
        if isDemo { return [] }
        let response: QueueResponse = try await decode(try await request("agent-sessions/\(id)/queue"))
        return response.entries
    }

    func prompt(_ prompt: String, sessionID: String, actionID: String, attachments: [NativeAgentPromptAttachment] = []) async throws -> NativeAgentControlResponse {
        if isDemo {
            var entries = demoEntries[sessionID] ?? NativeAgentFixtures.entries
            if !entries.contains(where: { $0.content["id"].string == actionID }) {
                entries += NativeAgentFixtures.turn(prompt: prompt, answer: "I’ll help you with that. Your message is in this native conversation.", actionID: actionID, attachments: attachments)
                demoEntries[sessionID] = entries
            }
            return .init(actionId: actionID, status: "sent")
        }
        var body: [String: WorkspaceJSON] = ["type": .string("prompt"), "prompt": .string(prompt), "actionId": .string(actionID)]
        if !attachments.isEmpty { body["attachments"] = try JSONDecoder().decode(WorkspaceJSON.self, from: JSONEncoder().encode(attachments)) }
        return try await decode(try await request("agent-sessions/\(sessionID)/control", method: "POST", body: .object(body)))
    }

    func setModel(_ model: String, sessionID: String) async throws {
        if isDemo {
            var value = demoRecords[sessionID] ?? NativeAgentFixtures.record(sessionID); value.model = model; demoRecords[sessionID] = value
            var rows = demoEntries[sessionID] ?? NativeAgentFixtures.entries
            rows.append(.init(id: MessageID.new(), createdAt: MessageDate.string(Date()), direction: "to_server", content: .object(["type": .string("acp"), "method": .string("session/update"), "params": .object(["update": .object(["sessionUpdate": .string("current_model_update"), "currentModelId": .string(model)])])])))
            demoEntries[sessionID] = rows; return
        }
        _ = try await request("agent-sessions/\(sessionID)/control", method: "POST", body: .object(["type": .string("setModel"), "model": .string(model)]))
    }

    func changes(_ id: String) async throws -> NativeAgentChanges {
        if isDemo { return NativeAgentChanges(capturing: false, changeset: NativeAgentChangeset(id: "preview-capture", additions: 12, deletions: 3, files: [.init(path: "launch-checklist.md", kind: "modified", additions: 12, deletions: 3, binary: false, patchOmitted: false)], truncated: false, capturedAt: "2026-09-27T12:00:00Z")) }
        return try await decode(try await request("agent-sessions/\(id)/changes"))
    }

    func patch(_ id: String) async throws -> String {
        if isDemo { return "diff --git a/launch-checklist.md b/launch-checklist.md\n--- a/launch-checklist.md\n+++ b/launch-checklist.md\n@@ -1,3 +1,5 @@\n # Mobile launch\n- Test in the browser\n+ Test native channel sending\n+ Review every screen on iPhone\n+ Verify drafts and retries\n" }
        struct Response: Decodable, Sendable { var patch: String }
        let response: Response = try await decode(try await request("agent-sessions/\(id)/changes/patch"))
        return response.patch
    }

    func pullRequest(_ url: URL) async throws -> ChannelAgentPullRequest? {
        guard let key = ChannelAgentPullRequest.githubKey(url) else { return nil }
        if isDemo { return .init(url: url, number: url.lastPathComponent, title: "Native mobile launch", status: "open", additions: 12, deletions: 3) }
        var request = URLRequest(url: baseURL.appendingPathComponent("dss/foreign_entity/by_source/github_pull_request/" + key))
        request.httpMethod = "GET"; request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let entity: WorkspaceJSON = try await decode(try await requestData(request))
            guard entity["foreignEntitySource"].string == "github_pull_request" else { return nil }
            let metadata = entity["metadata"]
            return .init(url: url, number: url.lastPathComponent, title: metadata["name"].string ?? metadata["displayName"].string,
                         status: metadata["status"].string, additions: metadata["additions"].number.map(Int.init), deletions: metadata["deletions"].number.map(Int.init))
        } catch NativeSessionError.requestFailed(404) { return nil }
    }

    func stop(_ id: String) async throws {
        if isDemo {
            var rows = demoEntries[id] ?? NativeAgentFixtures.entries
            if let promptID = rows.last(where: { $0.content["method"].string == "session/prompt" })?.content["id"] {
                rows.append(.init(id: MessageID.new(), createdAt: MessageDate.string(Date()), direction: "to_server", content: .object(["type": .string("acp"), "id": promptID, "result": .object(["stopReason": .string("cancelled")])])))
            }
            demoEntries[id] = rows; return
        }
        _ = try await request("agent-sessions/\(id)/control", method: "POST", body: .object(["type": .string("stop")]))
    }

    func answer(_ permission: NativeAgentPermission, optionID: String, sessionID: String) async throws {
        guard permission.options.contains(where: { $0["optionId"].string == optionID }) else { throw WorkspaceError.invalidResponse }
        guard !isDemo else { return }
        _ = try await request("agent-sessions/\(sessionID)/control", method: "POST", body: .object(["type": .string("respondToPermission"), "requestId": permission.requestID, "answer": .object(["kind": .string("selected"), "optionId": .string(optionID)])]))
    }

    func create(prompt: String, id: String, attachments: [NativeAgentPromptAttachment] = []) async throws -> NativeAgentRecord {
        // One caller ID names one immutable submission, including across an
        // uncertain create/control response. Retrying must not create or prompt twice.
        let draft = creationDrafts[id] ?? CreationDraft(prompt: prompt, attachments: attachments)
        creationDrafts[id] = draft
        if isDemo {
            if demoRecords[id] == nil {
                var record = NativeAgentFixtures.record(id); record.name = draft.prompt.isEmpty ? "Attached files" : String(draft.prompt.prefix(70))
                demoRecords[id] = record
                demoEntries[id] = draft.attachments.isEmpty ? NativeAgentFixtures.turn(prompt: draft.prompt, answer: "I’m ready to help. What would you like to explore next?", actionID: id + "-initial") : []
            }
            if !draft.attachments.isEmpty { _ = try await self.prompt(draft.prompt, sessionID: id, actionID: id, attachments: draft.attachments) }
            return demoRecords[id]!
        }
        let record: NativeAgentRecord
        do {
            var body: [String: WorkspaceJSON] = ["id": .string(id), "botId": .string(Self.macroBotID)]
            if draft.attachments.isEmpty { body["prompt"] = .string(draft.prompt) }
            let result: CreateResponse = try await decode(try await request("agent-sessions", method: "POST", body: .object(body)))
            record = result.session
        } catch NativeSessionError.requestFailed(409) {
            // The first response can be lost after creation commits. The caller retains
            // its session UUID, so a retry recovers that session instead of starting two.
            let existing = try await self.record(id)
            guard existing.id == id, existing.canEdit, existing.botId == Self.macroBotID else { throw WorkspaceError.invalidResponse }
            record = existing
        }
        if !draft.attachments.isEmpty {
            // Create accepts plain text only. Open idle, then deliver the file
            // prompt through control; its UUID namespace is separate from sessions.
            _ = try await self.prompt(draft.prompt, sessionID: id, actionID: id, attachments: draft.attachments)
        }
        return record
    }

    private func request(_ path: String, method: String = "GET", body: WorkspaceJSON? = nil) async throws -> Data {
        guard !isDemo else { throw WorkspaceError.invalidResponse }
        var request = URLRequest(url: baseURL.appendingPathComponent("agent-harness/" + path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        return try await requestData(request)
    }

    private func decode<T: Decodable & Sendable>(_ data: Data) async throws -> T {
        try await Task.detached(priority: .userInitiated) { try JSONDecoder().decode(T.self, from: data) }.value
    }
    private struct QueueResponse: Decodable, Sendable { var entries: [NativeAgentQueuedAction] }
    private struct CreateResponse: Decodable, Sendable { var session: NativeAgentRecord }
}

enum NativeAgentFixtures {
    static let bot = NativeAgentBot(id: "00000000-0000-0000-0000-00000000a1a1", name: "Macro", handle: "macro")
    static func record(_ id: String) -> NativeAgentRecord {
        NativeAgentRecord(id: id, name: "Mobile launch assistant", ownerId: "macro|native-demo@macro.local", botId: bot.id, harness: id == "workspace-agent" ? "claude-cloud" : "in-memory", model: "auto", canEdit: true, status: .object(["kind": .string("event"), "event": .string("acp_ready")]), repoUrl: id == "workspace-agent" ? "https://github.com/example/native-preview" : nil, pullRequestUrl: id == "workspace-agent" ? "https://github.com/example/native-preview/pull/42" : nil)
    }
    static var entries: [NativeAgentLogEntry] {
        var rows = turn(prompt: "Help me plan the mobile launch.", answer: "Here’s a focused launch plan:\n\n1. Test the native channel composer on a real iPhone.\n2. Review Files, Email, Calendar, and Tasks.\n3. Confirm every screen matches the existing app.\n\nI can help work through each step.", actionID: "demo-agent-initial", date: Date(timeIntervalSince1970: 1_790_500_000))
        rows.insert(.init(id: "demo-models", createdAt: MessageDate.string(Date(timeIntervalSince1970: 1_790_499_999)), direction: "to_server", content: .object(["type": .string("acp"), "id": .string("new-session"), "result": .object(["models": .object(["currentModelId": .string("auto"), "availableModels": .array([.object(["modelId": .string("auto"), "name": .string("Auto")]), .object(["modelId": .string("native-fast"), "name": .string("Fast")])])])])])), at: 0)
        for (index, title) in ["Read launch plan", "Review checklist"].enumerated() {
            rows.insert(.init(id: "demo-tool-\(index)", createdAt: MessageDate.string(Date(timeIntervalSince1970: 1_790_500_000.0001 + Double(index) * 0.0001)), direction: "to_server", content: .object(["type": .string("acp"), "method": .string("session/update"), "params": .object(["update": .object(["sessionUpdate": .string("tool_call"), "toolCallId": .string("demo-tool-\(index)"), "title": .string(title), "status": .string("completed"), "content": .array([.object(["type": .string("content"), "content": .object(["type": .string("text"), "text": .string("Reviewed the launch checklist.")])])])])])])), at: 2 + index)
        }
        if ProcessInfo.processInfo.arguments.contains("--test-agent-working") { rows.removeAll { $0.id == "demo-agent-initial-done" } }
        return rows
    }
    static func turn(prompt: String, answer: String, actionID: String, date: Date = Date(), attachments: [NativeAgentPromptAttachment] = []) -> [NativeAgentLogEntry] {
        let firstDate = MessageDate.string(date)
        let secondDate = MessageDate.string(date.addingTimeInterval(0.001))
        let thirdDate = MessageDate.string(date.addingTimeInterval(0.002))
        let blocks: [WorkspaceJSON] = (prompt.isEmpty ? [] : [.object(["type": .string("text"), "text": .string(prompt)])]) + attachments.map { .object(["type": .string("resource_link"), "uri": .string($0.uri), "name": .string($0.name)]) }
        return [
            .init(id: actionID + "-user", createdAt: firstDate, direction: "to_runtime", content: .object(["type": .string("acp"), "id": .string(actionID), "method": .string("session/prompt"), "params": .object(["prompt": .array(blocks)])])),
            .init(id: actionID + "-answer", createdAt: secondDate, direction: "to_server", content: .object(["type": .string("acp"), "method": .string("session/update"), "params": .object(["update": .object(["sessionUpdate": .string("agent_message_chunk"), "content": .object(["type": .string("text"), "text": .string(answer)])])])])),
            .init(id: actionID + "-done", createdAt: thirdDate, direction: "to_server", content: .object(["type": .string("acp"), "id": .string(actionID), "result": .object(["stopReason": .string("end_turn")])]))
        ]
    }
}
