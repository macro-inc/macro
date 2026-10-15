import Foundation

struct ChannelAgentCardDescriptor: Identifiable, Equatable, Sendable {
    let sessionID: String
    let turn: Int?
    let status: String
    var id: String { sessionID + ":" + (turn.map(String.init) ?? "latest") }
}

/// The persisted Lexical node is a reference to a turn, never message prose.
struct ChannelAgentCardContent: Equatable, Sendable {
    var body: String
    var cards: [ChannelAgentCardDescriptor]
    private static let expression = try! NSRegularExpression(pattern: #"<m-magic-chip>(.*?)</m-magic-chip>"#, options: [.dotMatchesLineSeparators])
    private static let statuses: Set<String> = ["no_messages", "booting", "acp_ready", "shutting_down", "disconnected"]

    static func parse(_ content: String) -> Self { project(content, replacement: "") }
    static func displayText(in content: String) -> String {
        let projected = project(content, replacement: "Agent session").body
        let result = NSMutableString(string: projected)
        let code = MentionCodec.codeRanges(in: projected)
        for match in expression.matches(in: projected, range: NSRange(projected.startIndex..., in: projected)).reversed()
        where !code.contains(where: { NSIntersectionRange($0, match.range).length > 0 }) {
            result.replaceCharacters(in: match.range, with: "Unknown agent session")
        }
        return result as String
    }

    private static func project(_ content: String, replacement: String) -> Self {
        let matches = expression.matches(in: content, range: NSRange(content.startIndex..., in: content))
        guard !matches.isEmpty else { return Self(body: content, cards: []) }
        let code = MentionCodec.codeRanges(in: content, mentionRanges: matches.map(\.range))
        var body = content, cards: [ChannelAgentCardDescriptor] = []
        for match in matches.reversed() {
            guard !code.contains(where: { NSIntersectionRange($0, match.range).length > 0 }),
                  let payload = Range(match.range(at: 1), in: content),
                  let json = try? JSONDecoder().decode(WorkspaceJSON.self, from: Data(content[payload].utf8)),
                  let id = json["agentSessionId"].string, !id.isEmpty,
                  let status = json["status"].string, statuses.contains(status),
                  let range = Range(match.range, in: body) else { continue }
            let turn: Int?
            if json["promptedMessage"] == .null { turn = nil }
            else {
                guard let value = json["promptedMessage"]["turn"].number, let index = Int(exactly: value), index >= 0,
                      ["user", "agent"].contains(json["promptedMessage"]["author"].string ?? "") else { continue }
                turn = index
            }
            cards.insert(.init(sessionID: id, turn: turn, status: status), at: 0)
            body.replaceSubrange(range, with: replacement)
        }
        var seen: Set<String> = []
        return Self(body: body.trimmingCharacters(in: .whitespacesAndNewlines), cards: cards.filter { seen.insert($0.id).inserted })
    }
}

struct ChannelAgentSummary: Equatable, Sendable {
    var status: String
    var text: String = ""
    var busy = false
    var waiting = false
    var finished = false

    static func fallback(_ status: String) -> Self {
        switch status {
        case "booting": .init(status: "Booting agent", busy: true)
        case "acp_ready": .init(status: "Waiting for agent", busy: true)
        case "shutting_down": .init(status: "Wrapping up")
        case "disconnected": .init(status: "Disconnected")
        default: .init(status: "Starting session")
        }
    }

    /// Turn IDs follow agent_fold: prompts, orphan/replayed prompts, and controls
    /// consume IDs. A chip pinned to an older turn never borrows a newer reply.
    static func project(_ entries: [NativeAgentLogEntry]) -> [Int: Self] {
        var nextTurn = 0, current: Int?, promptIDs: [String: Int] = [:]
        var rows: [Int: [NativeAgentLogEntry]] = [:], stop: [Int: String] = [:]
        var hasAgent = false, seen = Set<String>()
        func key(_ json: WorkspaceJSON) -> String? {
            switch json { case .string(let value): "s:" + value; case .number(let value): "n:" + String(value); default: nil }
        }
        for entry in NativeAgentReplay.committed(entries) where seen.insert(entry.id).inserted {
            let frame = entry.content, method = frame["method"].string
            if entry.direction == "to_runtime", ["session/set_model", "session/cancel"].contains(method ?? "") || (method == "session/set_config_option" && frame["params"]["configId"].string == "model") {
                nextTurn += 1; continue
            }
            if entry.direction == "to_runtime", method == "session/prompt" {
                current = nextTurn; nextTurn += 1; hasAgent = false
                if let id = key(frame["id"]), let current { promptIDs[id] = current }
            }
            let update = frame["params"]["update"]
            if entry.direction == "to_server", method == "session/update" {
                let kind = update["sessionUpdate"].string ?? ""
                if kind == "user_message_chunk" {
                    if current == nil || hasAgent {
                        if let current { stop[current] = "end_turn" }
                        current = nextTurn; nextTurn += 1; hasAgent = false
                    }
                } else if ["agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update", "plan"].contains(kind) {
                    if current == nil { current = nextTurn; nextTurn += 1 }
                    hasAgent = true
                }
            }
            if entry.direction == "to_server", method == nil,
               let turn = key(frame["id"]).flatMap({ promptIDs[$0] }) ?? (frame["result"]["stopReason"].string != nil ? current : nil) {
                rows[turn, default: []].append(entry)
                if let reason = frame["result"]["stopReason"].string { stop[turn] = reason }
                if frame["error"].object != nil { stop[turn] = "failed" }
                if turn == current { current = nil; hasAgent = false }
                continue
            }
            if let current { rows[current, default: []].append(entry) }
        }
        return rows.mapValues { entries in
            let transcript = NativeAgentTranscript.fold(entries)
            let latest = transcript.parts.last(where: { $0.kind == .text })?.text ?? ""
            if let pending = transcript.parts.last(where: { $0.permission?.answered == false || ($0.kind == .question && !["Answered", "Canceled"].contains($0.status)) }) {
                return Self(status: "Waiting for you", text: pending.text, waiting: true)
            }
            if let tool = transcript.parts.last(where: { $0.kind == .tool && ["pending", "in_progress", "running"].contains($0.status) }) {
                return Self(status: tool.title, text: latest, busy: true)
            }
            return Self(status: latest.isEmpty ? "Working" : "Writing response", text: latest, busy: true)
        }.mapValues { $0 }.merging(stop.reduce(into: [Int: Self]()) { result, entry in
            let text = NativeAgentTranscript.fold(rows[entry.key] ?? []).parts.last(where: { $0.kind == .text })?.text ?? ""
            let status: String
            switch entry.value {
            case "end_turn": status = text.isEmpty ? "Agent finished without a response" : "Done"
            case "cancelled": status = "Stopped"
            case "refusal": status = "Request refused"
            case "max_tokens": status = "Response limit reached"
            case "max_turn_requests": status = "Turn limit reached"
            case "failed": status = "Agent couldn’t answer"
            default: status = entry.value
            }
            result[entry.key] = Self(status: status, text: text, finished: entry.value == "end_turn")
        }, uniquingKeysWith: { _, ended in ended })
    }
}

struct ChannelAgentPullRequest: Equatable, Sendable {
    var url: URL
    var number: String
    var title: String?
    var status: String?
    var additions: Int?
    var deletions: Int?

    static func githubKey(_ url: URL) -> String? {
        guard url.scheme == "https", url.host?.lowercased() == "github.com" else { return nil }
        let parts = url.path.split(separator: "/")
        guard parts.count == 4, parts[2] == "pull", Int(parts[3]).map({ $0 > 0 }) == true else { return nil }
        return parts.joined(separator: "/")
    }
}
