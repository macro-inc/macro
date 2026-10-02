import Foundation

struct NativeAgentRecord: Decodable, Identifiable, Sendable {
    var id: String
    var name: String
    var ownerId: String
    var botId: String
    var harness: String
    var model: String
    var canEdit: Bool
    var status: WorkspaceJSON
    var repoUrl: String?
    var pullRequestUrl: String?
    var createdAt: String?
    var modifiedAt: String?
    var isCoding: Bool { !["in-memory", "macro-inmem", "sandbox"].contains(harness) }
    var repository: String? {
        guard isCoding, let repoUrl, let url = URL(string: repoUrl) else { return nil }
        return url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}

struct NativeAgentBot: Decodable, Sendable {
    var id: String
    var name: String
    var handle: String
    var avatarUrl: String?
}

struct NativeAgentLogEntry: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var createdAt: String
    var userId: String?
    var direction: String
    var content: WorkspaceJSON
}

struct NativeAgentLog: Decodable, Sendable {
    var bot: NativeAgentBot
    var entries: [NativeAgentLogEntry]
}

struct NativeAgentQueuedAction: Decodable, Identifiable, Sendable, Equatable {
    var actionId: String
    var kind: String
    var prompt: String?
    var createdAt: String
    var id: String { actionId }
}

struct NativeAgentPromptAttachment: Codable, Identifiable, Sendable, Equatable {
    var uri: String
    var name: String
    var mimeType: String?
    var size: Int?
    var id: String { uri }
}

struct NativeAgentModel: Decodable, Identifiable, Sendable, Equatable {
    var id: String
    var name: String
}

struct NativeAgentControlResponse: Decodable, Sendable {
    var actionId: String
    var status: String
}

struct NativeAgentPermission: Sendable, Equatable {
    var requestID: WorkspaceJSON
    var options: [WorkspaceJSON]
    var answered = false
}

struct NativeAgentPart: Identifiable, Sendable, Equatable {
    enum Kind: String, Sendable { case user, text, thought, tool, plan, permission, question, notice }
    var id: String
    var kind: Kind
    var text: String
    var title: String = ""
    var status: String = ""
    var requestID: String? = nil
    var permission: NativeAgentPermission? = nil
    var detail: String = ""
    var images: [NativeAgentImage] = []
}

/// Projects ACP log frames into the same transcript hierarchy as the web client.
/// Durable row IDs deduplicate transport overlap; JSON-RPC IDs preserve number/string identity.
struct NativeAgentTranscript: Sendable {
    var parts: [NativeAgentPart] = []
    var isWorking = false
    var isWaiting = false
    var promptIDs: Set<String> = []
    var models: [NativeAgentModel] = []
    var currentModel: String?
    private var toolIndices: [String: Int] = [:]
    private var requestIndices: [String: Int] = [:]
    private var activePrompts: Set<String> = []
    private var planIndex: Int?
    private var seen: Set<String> = []

    static func fold(_ entries: [NativeAgentLogEntry]) -> NativeAgentTranscript {
        var transcript = NativeAgentTranscript()
        for entry in NativeAgentReplay.committed(entries) { transcript.ingest(entry) }
        return transcript
    }

    mutating func ingest(_ entry: NativeAgentLogEntry) {
        guard seen.insert(entry.id).inserted else { return }
        let frame = entry.content
        let method = frame["method"].string
        let rpcID = Self.key(frame["id"])
        let offered = frame["result"]["models"]["availableModels"].array
        if !offered.isEmpty {
            models = offered.compactMap { item in
                guard let id = item["modelId"].string, let name = item["name"].string else { return nil }
                return NativeAgentModel(id: id, name: name)
            }
            currentModel = frame["result"]["models"]["currentModelId"].string
        }
        if frame["type"].string == "event" {
            if ["disconnected", "runtime_disconnected", "acp_disconnected", "error"].contains(frame["event"].string ?? "") { applyTurnState("disconnected") }
            return
        }
        if entry.direction == "to_runtime", method == "session/prompt" {
            toolIndices = [:]; planIndex = nil
            let text = Self.contentText(frame["params"]["prompt"])
            let images = NativeAgentImage.content(frame["params"]["prompt"])
            if !text.isEmpty || !images.isEmpty {
                parts.append(.init(id: entry.id, kind: .user, text: text, requestID: frame["id"].string, images: images))
            }
            if let rpcID { activePrompts.insert(rpcID) }
            if let id = frame["id"].string { promptIDs.insert(id) }
            isWorking = true
            return
        }
        if entry.direction == "to_runtime", method == nil, let rpcID, let index = requestIndices[rpcID] {
            parts[index].permission?.answered = true
            parts[index].status = "Answered"
            isWaiting = parts.contains { $0.permission?.answered == false || ($0.kind == .question && !["Answered", "Canceled"].contains($0.status)) }
            return
        }
        if entry.direction == "to_server", method == nil, let rpcID, activePrompts.remove(rpcID) != nil {
            isWorking = !activePrompts.isEmpty
            if !isWorking {
                isWaiting = false
                for index in parts.indices where parts[index].permission?.answered == false || (parts[index].kind == .question && parts[index].status != "Answered") {
                    parts[index].permission?.answered = true; parts[index].status = "Canceled"
                }
            }
            if let error = frame["error"]["message"].string {
                parts.append(.init(id: entry.id, kind: .notice, text: error, status: "failed"))
            }
            return
        }
        guard entry.direction == "to_server" else { return }
        if let error = frame["error"]["message"].string {
            parts.append(.init(id: entry.id, kind: .notice, text: error, status: "failed")); return
        }
        if method == "session/request_permission", let rpcID {
            requestIndices[rpcID] = parts.count
            let params = frame["params"]
            parts.append(.init(id: entry.id, kind: .permission, text: params["toolCall"]["title"].string ?? "The agent needs your permission", permission: .init(requestID: frame["id"], options: params["options"].array)))
            isWaiting = true
            return
        }
        if method == "elicitation/create", let rpcID {
            requestIndices[rpcID] = parts.count
            parts.append(.init(id: entry.id, kind: .question, text: frame["params"]["message"].string ?? "The agent needs more information.", detail: "Open this session on the web to answer this form."))
            isWaiting = true
            return
        }
        let configs = frame["result"]["configOptions"].array
        if !configs.isEmpty { readModelOptions(configs) }
        guard method == "session/update" else { return }
        let update = frame["params"]["update"]
        switch update["sessionUpdate"].string {
        case "agent_message_chunk", "agent_thought_chunk", "user_message_chunk":
            let kind: NativeAgentPart.Kind = update["sessionUpdate"].string == "agent_thought_chunk" ? .thought : update["sessionUpdate"].string == "user_message_chunk" ? .user : .text
            let text = Self.contentText(update["content"])
            let images = NativeAgentImage.content(update["content"])
            guard !text.isEmpty || !images.isEmpty else { return }
            // A messageId distinguishes adjacent messages of the same role where provided.
            let messageID = update["messageId"].string
            if images.isEmpty, let last = parts.indices.last, parts[last].images.isEmpty, parts[last].kind == kind, parts[last].requestID == messageID {
                parts[last].text += text
                parts[last].images.append(contentsOf: images)
            } else { parts.append(.init(id: entry.id, kind: kind, text: text, requestID: messageID, images: images)) }
        case "tool_call", "tool_call_update":
            guard let id = update["toolCallId"].string else { return }
            let index: Int
            if let existing = toolIndices[id] { index = existing }
            else {
                index = parts.count; toolIndices[id] = index
                parts.append(.init(id: "tool-" + entry.id, kind: .tool, text: "", title: update["title"].string ?? "Tool", status: update["status"].string ?? "pending"))
            }
            if let title = update["title"].string { parts[index].title = title }
            if let status = update["status"].string { parts[index].status = status }
            let images = NativeAgentImage.content(update["content"])
            if !images.isEmpty { parts[index].images = images }
            let content = Self.contentText(update["content"])
            if !content.isEmpty { parts[index].text = String(content.prefix(24_000)) }
            if let output = update["_meta"]["terminal_output"]["data"].string {
                parts[index].text = Self.cleanTerminal(output)
            }
            if let input = update["rawInput"]["command"].string ?? update["rawInput"]["file_path"].string { parts[index].detail = input }
        case "config_option_update": readModelOptions(update["configOptions"].array)
        case "current_model_update": currentModel = update["currentModelId"].string
        case "plan":
            let text = update["entries"].array.map { entry in
                let prefix = entry["status"].string == "completed" ? "✓ " : "• "
                return prefix + (entry["content"].string ?? "")
            }.joined(separator: "\n")
            if let index = planIndex { parts[index].text = text }
            else { planIndex = parts.count; parts.append(.init(id: entry.id, kind: .plan, text: text, title: "Plan")) }
        default: break
        }
    }

    mutating func applyTurnState(_ state: String) {
        switch state {
        case "starting", "running", "stopping": isWorking = true; isWaiting = false
        case "blocked": isWorking = true; isWaiting = true
        case "idle", "disconnected":
            isWorking = false; isWaiting = false; activePrompts.removeAll()
            for index in parts.indices where parts[index].permission?.answered == false || (parts[index].kind == .question && parts[index].status != "Answered") {
                parts[index].permission?.answered = true; parts[index].status = "Canceled"
            }
        default: break
        }
    }

    private mutating func readModelOptions(_ configs: [WorkspaceJSON]) {
        guard let selector = configs.first(where: { $0["id"].string == "model" || $0["category"].string == "model" }) else { return }
        currentModel = selector["currentValue"].string
        let flattened = selector["options"].array.flatMap { option in option["options"].array.isEmpty ? [option] : option["options"].array }
        models = flattened.compactMap { option in
            guard let id = option["value"].string, let name = option["name"].string else { return nil }
            return NativeAgentModel(id: id, name: name)
        }
    }

    private static func key(_ value: WorkspaceJSON) -> String? {
        switch value { case .string(let string): return "s:" + string; case .number(let number): return "n:" + String(number); default: return nil }
    }

    static func contentText(_ content: WorkspaceJSON) -> String {
        if let array = content.object == nil ? Optional(content.array) : nil, !array.isEmpty {
            return array.map(contentText).joined(separator: "\n")
        }
        switch content["type"].string {
        case "text": return content["text"].string ?? ""
        case "content": return contentText(content["content"])
        case "resource_link": return content["name"].string ?? content["uri"].string ?? "Attachment"
        case "resource": return content["resource"]["text"].string ?? content["resource"]["uri"].string ?? "Attachment"
        case "image": return ""
        case "diff": return (content["path"].string ?? "Changed file") + "\n" + (content["newText"].string ?? "")
        default: return ""
        }
    }

    private static func cleanTerminal(_ text: String) -> String {
        let suffix = String(text.suffix(24_000))
        return suffix.replacingOccurrences(of: "\u{001B}\\[[0-9;]*[A-Za-z]", with: "", options: .regularExpression)
    }
}

struct NativeAgentChanges: Decodable, Sendable {
    var capturing: Bool
    var changeset: NativeAgentChangeset?
    var attempt: WorkspaceJSON?
}

struct NativeAgentChangeset: Decodable, Identifiable, Sendable {
    var id: String
    var additions: Int
    var deletions: Int
    var files: [NativeAgentChangedFile]
    var truncated: Bool
    var capturedAt: String
}

struct NativeAgentChangedFile: Decodable, Identifiable, Sendable {
    var path: String
    var kind: String
    var additions: Int
    var deletions: Int
    var binary: Bool
    var patchOmitted: Bool
    var previousPath: String?
    var id: String { path }
}
