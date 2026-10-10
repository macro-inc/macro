#if DEBUG
import Foundation

/// Explicit launch-argument fixture. Never authenticates or sends real messages.
@MainActor
final class FixtureMessagingService: MessagingService {
    static let channelID = "01900000-0000-7000-8000-000000000001"
    static let ownID = "macro|native-demo@macro.local"
    private let teammate = "macro|jamie@macro.local"
    var onMessage: ((ChatMessage) -> Void)?
    private var history: [String: [ChatMessage]] = [:]
    private var failedOnce = false
    private var scheduledResize = false

    init() {
        let notes = [
            "Morning! A few details for the new mobile experience.",
            "Keep the things we do all day really close. Conversations first.",
            "Yes. Especially the keyboard — sending should feel effortless.",
            "A native composer, with all the room you need to think.",
            "And docs can open right here when we need them.",
            "Just tried it. This feels so much better already."
        ]
        history[Self.channelID] = (0..<46).map { index in
            let date = ISO8601DateFormatter().string(from: Date().addingTimeInterval(Double(index - 46) * 90))
            return ChatMessage(id: "fixture-\(index)", parent: MessageParent(id: Self.channelID),
                senderID: index % 3 == 0 ? Self.ownID : teammate, content: notes[index % notes.count], createdAt: date, updatedAt: date)
        }
        if ProcessInfo.processInfo.arguments.contains("--test-short-channel") { history[Self.channelID] = Array(history[Self.channelID]!.suffix(2)) }
        if ProcessInfo.processInfo.arguments.contains("--test-collapsed-thread") {
            for index in 1...5 {
                let date = ISO8601DateFormatter().string(from: Date().addingTimeInterval(Double(index - 6)))
                history[Self.channelID, default: []].append(ChatMessage(id: "fixture-reply-\(index)", parent: MessageParent(id: Self.channelID),
                    senderID: teammate, content: "Inline reply \(index)", createdAt: date, updatedAt: date, threadID: "fixture-45"))
            }
        }
        if ProcessInfo.processInfo.arguments.contains("--test-thread-scrolling") {
            for rootIndex in 38...45 {
                for index in 1...8 {
                    let date = ISO8601DateFormatter().string(from: Date().addingTimeInterval(Double(rootIndex * 10 + index - 460)))
                    let paragraph = "A longer reply wraps over several lines so the timeline must measure the entire message before positioning the next avatar. "
                    history[Self.channelID, default: []].append(ChatMessage(id: "stress-\(rootIndex)-\(index)", parent: MessageParent(id: Self.channelID),
                        senderID: teammate, content: "Reply \(rootIndex).\(index)\n" + String(repeating: paragraph, count: index % 4 + 1), createdAt: date, updatedAt: date, threadID: "fixture-\(rootIndex)"))
                }
            }
        }

    }

    func channels(cursor: String?) async throws -> ChannelPage {
        let latest = history[Self.channelID]!.last!
        return ChannelPage(items: [
            Channel(id: Self.channelID, name: "Product & design", channelType: "private",
                participants: [.init(userID: Self.ownID), .init(userID: teammate)],
                latestMessage: ChannelPreview(messageID: latest.id, content: latest.content, senderID: latest.senderID, createdAt: latest.createdAt), updatedAt: latest.createdAt),
            Channel(id: "01900000-0000-7000-8000-000000000002", name: "Jamie Chen", channelType: "direct_message",
                participants: [.init(userID: teammate)], latestMessage: ChannelPreview(messageID: "preview-2", content: "The little details make all the difference.", senderID: teammate, createdAt: latest.createdAt), updatedAt: latest.createdAt),
            Channel(id: "01900000-0000-7000-8000-000000000003", name: "Team Macro", channelType: "public",
                latestMessage: ChannelPreview(messageID: "preview-3", content: "A space for what’s next. ✨", senderID: teammate, createdAt: latest.createdAt), updatedAt: latest.createdAt),
            Channel(id: "01900000-0000-7000-8000-000000000004", name: "Ideas & inspiration", channelType: "private",
                latestMessage: ChannelPreview(messageID: "preview-4", content: "Saved a few things for our next brainstorm.", senderID: teammate, createdAt: latest.createdAt), updatedAt: latest.createdAt)
        ])
    }

    func messages(channelID: String, cursor: MessageCursor?) async throws -> MessagePage {
        if ProcessInfo.processInfo.arguments.contains("--test-scrolling-resize"), !scheduledResize {
            scheduledResize = true
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(12))
                guard let self, let index = self.history[channelID]?.firstIndex(where: { $0.id == "fixture-38" }) else { return }
                self.history[channelID]![index].content = "Older message resized\n" + String(repeating: "An attachment or loaded body can grow well above the message currently being read. ", count: 24)
                self.history[channelID]![index].updatedAt = MessageDate.string(Date())
                self.onMessage?(self.history[channelID]![index])
            }
        }
        let all = (history[channelID] ?? []).filter { $0.threadID == nil }.map { root -> ChatMessage in
            var root = root
            let replies = (history[channelID] ?? []).filter { $0.threadID == root.id }.sorted { $0.date < $1.date }
            if !replies.isEmpty { root.thread = MessageThreadPreview(replyCount: replies.count, preview: Array(replies.prefix(3)), latestReplyAt: replies.last?.createdAt) }
            return root
        }
        let end = cursor.flatMap { cursor in all.firstIndex { $0.id == cursor.id } } ?? all.count
        let start = max(0, end - 20)
        let items = Array(all[start..<end])
        return MessagePage(items: items, nextCursor: start > 0 ? MessageCursor(createdAt: all[start].createdAt, id: all[start].id) : nil)
    }

    func send(channelID: String, content: String, nonce: String) async throws -> ChatMessage {
        try await send(channelID: channelID, content: content, nonce: nonce, attachments: [])
    }

    func send(channelID: String, content: String, nonce: String, attachments: [MessageAttachment]) async throws -> ChatMessage {
        try await send(channelID: channelID, content: content, nonce: nonce, attachments: attachments, threadID: nil)
    }
    func send(channelID: String, content: String, nonce: String, attachments: [MessageAttachment], threadID: String?) async throws -> ChatMessage {
        try await Task.sleep(for: .milliseconds(600))
        if (ProcessInfo.processInfo.arguments.contains("--test-send-failure") || (threadID != nil && ProcessInfo.processInfo.arguments.contains("--test-thread-send-failure"))) && !failedOnce {
            failedOnce = true; throw URLError(.notConnectedToInternet)
        }
        if let previous = history[channelID]?.first(where: { $0.id == nonce }) { return previous }
        let date = ISO8601DateFormatter().string(from: Date())
        let message = ChatMessage(id: nonce, parent: MessageParent(id: channelID), senderID: Self.ownID,
            content: content, createdAt: date, updatedAt: date, threadID: threadID, attachments: attachments, nonce: nonce)
        history[channelID, default: []].append(message)
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard let self else { return }
            let incoming = ChatMessage(id: MessageID.new(), parent: message.parent, senderID: self.teammate,
                content: "Received — that was quick!", createdAt: ISO8601DateFormatter().string(from: Date()), updatedAt: ISO8601DateFormatter().string(from: Date()), threadID: threadID)
            self.history[channelID, default: []].append(incoming)
            self.onMessage?(incoming)
        }
        return message
    }

    func thread(channelID: String, rootID: String) async throws -> ChannelThread {
        let root = try await getMessage(channelID: channelID, messageID: rootID)
        return ChannelThread(root: root, replies: (history[channelID] ?? []).filter { $0.threadID == rootID }.sorted { $0.date < $1.date },
            state: root.state ?? MessageThreadState(rootID: rootID, userID: root.senderID, createdAt: root.createdAt, updatedAt: root.updatedAt))
    }
    func getMessage(channelID: String, messageID: String) async throws -> ChatMessage {
        guard let message = history[channelID]?.first(where: { $0.id == messageID }) else { throw MessagingError.http(404) }
        return message
    }
    func userNames(userIDs: [String]) async throws -> [String: String] { [teammate: "Jamie Chen"] }
}
#endif
