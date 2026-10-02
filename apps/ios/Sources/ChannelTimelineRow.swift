import SwiftUI

/// Each message is a separate self-sizing table row. A growing thread must never
/// retain one estimated height for all of its asynchronously rendered children.
struct ChannelTimelineEntry: Identifiable {
    enum Kind { case root, reply, footer }
    let id: String
    let kind: Kind
    let message: ChatMessage
    let root: ChatMessage
    let hiddenCount: Int
    let hiddenParticipants: [String]
    let hasReplies: Bool
    var grouped = false
    var firstReply = false

    static func make(messages: [ChatMessage], expanded: Set<String>, replyingTo: String?) -> [Self] {
        messages.enumerated().flatMap { rootIndex, root -> [Self] in
            let all = root.thread?.preview ?? []
            let replies = expanded.contains(root.id) || replyingTo == root.id ? all : Array(all.prefix(3))
            let hidden = max(0, root.replyCount - replies.count)
            var seen = Set<String>()
            let participants = all.dropFirst(replies.count).map(\.senderID).filter { seen.insert($0).inserted }
            func entry(_ kind: Kind, _ message: ChatMessage, _ id: String) -> Self {
                .init(id: id, kind: kind, message: message, root: root, hiddenCount: hidden,
                      hiddenParticipants: participants, hasReplies: !replies.isEmpty || hidden > 0)
            }
            var rootEntry = entry(.root, root, root.id)
            rootEntry.grouped = shouldGroup(root, previous: rootIndex > 0 ? messages[rootIndex - 1] : nil)
            var result = [rootEntry]
            result += replies.enumerated().map { index, reply in
                var item = entry(.reply, reply, reply.id)
                item.grouped = shouldGroup(reply, previous: index > 0 ? replies[index - 1] : nil)
                item.firstReply = index == 0
                return item
            }
            if !replies.isEmpty || hidden > 0 { result.append(entry(.footer, root, "thread-footer:" + root.id)) }
            return result
        }
    }
    static func shouldGroup(_ current: ChatMessage, previous: ChatMessage?) -> Bool {
        guard let previous, current.senderID == previous.senderID,
              current.sender?.triggeredBy == previous.sender?.triggeredBy,
              !current.isDeleted, !previous.isDeleted, previous.replyCount == 0 else { return false }
        let gap = current.date.timeIntervalSince(previous.date)
        return gap >= 0 && gap <= 300
    }

}

struct ChannelTimelineRow: View {
    let entry: ChannelTimelineEntry
    let userID: String
    let names: [String: String]
    let photos: [String: URL]
    let actions: ConversationActions
    var showNew = false
    var selected = false

    var body: some View {
        VStack(spacing: 0) {
            if showNew {
                HStack(spacing: 10) {
                    Rectangle().frame(height: 0.5)
                    Text("New").font(.system(size: 12, weight: .medium))
                    Rectangle().frame(height: 0.5)
                }.foregroundStyle(MacroTheme.accent).padding(.horizontal, 16).padding(.vertical, 24)
            }
            switch entry.kind {
            case .root:
                messageRow
                    .background(alignment: .leading) {
                        if entry.hasReplies { Rectangle().fill(Color.primary.opacity(0.22)).frame(width: 1).padding(.top, 51).padding(.leading, 32.5) }
                    }
            case .reply:
                messageRow.padding(.leading, 32).padding(.top, entry.firstReply ? 8 : 0)
                    .background { ThreadRail(grouped: entry.grouped, first: entry.firstReply) }
            case .footer:
                footer.background { ThreadRail(last: true) }
            }
        }.fixedSize(horizontal: false, vertical: true)
    }

    private var messageRow: some View {
        let item = entry.message
        let author = item.botProfile?.name ?? item.sender?.name ?? names[item.senderID] ?? item.senderID.replacingOccurrences(of: "macro|", with: "").components(separatedBy: "@")[0]
        return MessageRow(message: item, author: author, isOwn: item.senderID == userID,
            delivery: actions.store.pending[item.id], deliveryError: actions.store.deliveryErrors[item.id],
            retry: { actions.store.retry(item) }, openWeb: actions.openWeb, photoURL: photos[item.senderID],
            reply: { actions.reply(item) }, react: { actions.react(item, $0) },
            edit: { actions.edit(item) }, delete: { actions.delete(item) }, openAttachment: actions.attachment,
            openAgent: actions.agent, shownReplyCount: 0, session: actions.session, names: names, userID: userID,
            menu: { actions.menu(item) }, expand: { actions.expand(entry.root) }, grouped: entry.grouped)
            .background { RoundedRectangle(cornerRadius: 6).fill(selected ? MacroTheme.accent.opacity(0.35) : .clear).padding(.horizontal, 8) }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if actions.store.loadingThreads.contains(entry.root.id) { ProgressView().controlSize(.mini) }
            if let error = actions.store.threadErrors[entry.root.id] {
                HStack { Text(error).font(.caption).foregroundStyle(.secondary); Button("Retry") { actions.expand(entry.root) } }
            }
            HStack {
                if entry.hiddenCount > 0 {
                    Button { actions.expand(entry.root) } label: {
                        HStack(spacing: 8) {
                            if !entry.hiddenParticipants.isEmpty {
                                HStack(spacing: -4) {
                                    ForEach(Array(entry.hiddenParticipants.prefix(4)), id: \.self) { id in
                                        AvatarView(name: names[id] ?? "", size: 18, photoURL: photos[id])
                                            .overlay(Circle().stroke(MacroTheme.background, lineWidth: 2))
                                    }
                                }
                            }
                            Text("\(entry.hiddenCount) more \(entry.hiddenCount == 1 ? "reply" : "replies")")
                                .font(.system(size: 12.75, weight: .medium)).foregroundStyle(MacroTheme.accent)
                            MacroIcon(name: "caret-right", size: 14).foregroundStyle(.secondary)
                        }.padding(.leading, 6.375).padding(.trailing, 8.5).frame(height: 34)
                            .overlay(Capsule().stroke(Color.primary.opacity(0.22), lineWidth: 0.8)).contentShape(Capsule())
                    }.buttonStyle(.plain).accessibilityIdentifier("expand-thread-" + entry.root.id)
                } else {
                    Button { actions.reply(entry.root) } label: {
                        MacroIcon(name: "plus", size: 21.25).frame(width: 34, height: 34)
                            .overlay(Circle().stroke(Color.primary.opacity(0.25), lineWidth: 0.8))
                    }.buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("Reply in thread")
                }
                Spacer()
            }
        }.padding(.leading, 49).padding(.trailing, 17).padding(.top, 8.5).padding(.bottom, 17)
    }
}

private struct ThreadRail: View {
    var last = false
    var grouped = false
    var first = false
    var body: some View {
        GeometryReader { geometry in
            Path { path in
                let x: CGFloat = 33
                path.move(to: CGPoint(x: x, y: 0))
                path.addLine(to: CGPoint(x: x, y: last ? 4 : geometry.size.height))
                if !grouped {
                    let end: CGFloat = last ? 24 : (first ? 34 : 26)
                    path.move(to: CGPoint(x: x, y: end - 12))
                    path.addQuadCurve(to: CGPoint(x: x + 8, y: end), control: CGPoint(x: x, y: end))
                }
            }.stroke(Color.primary.opacity(0.22), lineWidth: 0.75)
        }.allowsHitTesting(false).accessibilityHidden(true)
    }
}

struct ChannelAgentLink: Equatable {
    let id: String
    let body: String
    private static let expression = try! NSRegularExpression(pattern: #"^<m-agent-session-mention>(.*?)</m-agent-session-mention>[ \t]*(?:(?:\r?\n)+|$)"#)
    static func parse(_ message: ChatMessage) -> ChannelAgentLink? {
        guard message.senderID.hasPrefix("bot|"),
              let match = expression.firstMatch(in: message.content, range: NSRange(message.content.startIndex..., in: message.content)),
              let payloadRange = Range(match.range(at: 1), in: message.content),
              let payload = String(message.content[payloadRange]).data(using: .utf8),
              let json = (try? JSONSerialization.jsonObject(with: payload)) as? [String: Any],
              let id = json["id"] as? String, !id.isEmpty,
              let prefix = Range(match.range, in: message.content) else { return nil }
        return ChannelAgentLink(id: id, body: String(message.content[prefix.upperBound...]))
    }
}
