import SwiftUI
import UIKit

struct MessageRow: View {
    let message: ChatMessage
    let author: String
    let isOwn: Bool
    let delivery: DeliveryState?
    let deliveryError: String?
    let retry: () -> Void
    let openWeb: () -> Void
    var photoURL: URL? = nil
    var reply: (() -> Void)? = nil
    var react: ((String) -> Void)? = nil
    var edit: (() -> Void)? = nil
    var delete: (() -> Void)? = nil
    var openAttachment: ((MessageAttachment) -> Void)? = nil
    var openAgent: ((String) -> Void)? = nil
    var shownReplyCount: Int? = nil
    var replyLabelSuffix = "replies"
    var session: NativeSession? = nil
    var names: [String: String] = [:]
    var userID = ""
    var menu: (() -> Void)? = nil
    var expand: (() -> Void)? = nil
    var grouped = false
    @State private var swipeOffset: CGFloat = 0
    @State private var crossedThreshold = false
    private var quotes: [ReplyTargetQuote] { ReplyTargetContent.split(message.content).quotes }
    private var projection: ChannelAgentCardContent { ChannelAgentCardContent.parse(ReplyTargetContent.split(agentLink?.body ?? message.content).body) }
    private var count: Int { shownReplyCount ?? message.replyCount }
    private var agentLink: ChannelAgentLink? { ChannelAgentLink.parse(message) }
    @ScaledMetric(relativeTo: .body) private var bodySize: CGFloat = 15.9375
    @ScaledMetric(relativeTo: .body) private var senderSize: CGFloat = 14.875
    @ScaledMetric(relativeTo: .body) private var timeSize: CGFloat = 12.75

    var body: some View {
        HStack(alignment: .top, spacing: 8.5) {
            if grouped { Color.clear.frame(width: 32, height: 0) }
            else if message.senderID.hasPrefix("bot|") || message.sender?.type == "bot" || message.botProfile != nil {
                NativeBotAvatar(id: message.senderID, name: author, photoURL: (message.botProfile?.avatarURL ?? message.sender?.avatarURL).flatMap(URL.init(string:)) ?? photoURL)
            } else { AvatarView(name: author, size: 32, photoURL: message.sender?.avatarURL.flatMap(URL.init(string:)) ?? photoURL) }
            VStack(alignment: .leading, spacing: 4.25) {
                if !grouped {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(author).font(.system(size: senderSize, weight: .medium)).lineLimit(1)
                    if message.botProfile != nil { Text("Agent").font(.caption2).padding(.horizontal, 5).background(.quaternary, in: Capsule()) }
                    Text(message.date, style: .time).font(.system(size: timeSize)).foregroundStyle(.secondary)
                    if message.editedAt != nil { Text("edited").font(.caption2).foregroundStyle(.tertiary) }
                }.frame(minHeight: 20)
                if let triggeredBy = message.sender?.triggeredBy {
                    (Text("from ").foregroundColor(.secondary) + Text(names[triggeredBy] ?? triggeredBy.replacingOccurrences(of: "macro|", with: "")).foregroundColor(MacroTheme.accent))
                        .font(.system(size: 12))
                }
                }
                if let agentLink, projection.cards.isEmpty {
                    Button { openAgent?(agentLink.id) } label: { Label("Open agent", systemImage: "sparkles").font(.system(size: 12)).foregroundStyle(MacroTheme.accent) }.buttonStyle(.plain)
                }
                ForEach(quotes) { quote in
                    NativeReplyQuote(sender: quote.senderName(currentUserID: userID, names: names), text: quote.displayText)
                }
                if !projection.body.isEmpty || message.isDeleted {
                Text(message.isDeleted ? AttributedString("Message deleted") : richText)
                    .font(.system(size: bodySize)).foregroundStyle(message.isDeleted ? .secondary : .primary)
                    .lineSpacing(max(0, bodySize * 1.6 - UIFont.systemFont(ofSize: bodySize).lineHeight)).padding(.vertical, 2.125 + max(0, bodySize * 1.6 - UIFont.systemFont(ofSize: bodySize).lineHeight) / 2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                if !message.isDeleted, let session {
                    ForEach(projection.cards) { card in ChannelAgentCard(descriptor: card, session: session) { openAgent?($0) } }
                }
                if !message.attachments.isEmpty && !message.isDeleted {
                    ForEach(message.attachments) { attachment in
                        if let session {
                            NativeMessageAttachmentPreview(attachment: attachment, session: session) {
                                if let openAttachment { openAttachment(attachment) } else { openWeb() }
                            }
                        } else {
                            Button("Open attachment") { if let openAttachment { openAttachment(attachment) } else { openWeb() } }
                                .buttonStyle(.plain)
                        }
                    }
                }
                if !message.reactions.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(message.reactions, id: \.emoji) { reaction in
                            Button { if let react { react(reaction.emoji) } else { openWeb() } } label: {
                                HStack(spacing: 4) {
                                    Text(reaction.emoji).font(.system(size: 19.125))
                                    if reaction.users.count > 1 { Text("\(reaction.users.count)").font(.system(size: 12.75)) }
                                }.padding(.horizontal, 8).frame(minWidth: 29.75, minHeight: 29.75)
                                    .background(reaction.users.contains(userID) ? MacroTheme.accent.opacity(0.16) : Color.primary.opacity(0.04), in: Capsule())
                                    .overlay(Capsule().stroke(Color.primary.opacity(0.07), lineWidth: 1))
                            }.buttonStyle(.plain).foregroundStyle(reaction.users.contains(userID) ? MacroTheme.accent : .secondary)
                                .accessibilityLabel("\(reaction.emoji) \(reaction.users.count)")
                        }
                    }
                }
                if count > 0 {
                    Button(action: expand ?? reply ?? openWeb) {
                        HStack(spacing: 6) {
                            Image(systemName: "bubble.left.and.bubble.right")
                            Text("\(count) \(count == 1 && replyLabelSuffix == "replies" ? "reply" : replyLabelSuffix)")
                            Image(systemName: "chevron.right").font(.system(size: 10))
                        }.font(.system(size: 13, weight: .medium)).padding(.horizontal, 10).padding(.vertical, 7)
                            .overlay(Capsule().stroke(.quaternary, lineWidth: 1))
                    }.buttonStyle(.plain).foregroundStyle(.blue)
                }
                if delivery == .sending { Text("Sending…").font(.caption2).foregroundStyle(.secondary) }
                else if delivery == .failed {
                    Button(action: retry) { Label("Not sent · tap to retry", systemImage: "exclamationmark.circle").font(.caption) }
                        .tint(.red).accessibilityIdentifier("retry-\(message.id)")
                    if let deliveryError { Text(deliveryError).font(.caption2).foregroundStyle(.secondary) }
                }
            }
        }.padding(.horizontal, 17).padding(.top, grouped ? 0 : 10.625).padding(.bottom, 4.25)
            .accessibilityElement(children: .contain).accessibilityIdentifier("message-\(message.id)")
            .contentShape(Rectangle())
            .offset(x: swipeOffset)
            .background(alignment: .trailing) {
                if crossedThreshold {
                    MacroIcon(name: "arrow-bend-up-left", size: 20).foregroundStyle(MacroTheme.background)
                        .frame(width: 36, height: 36).background(MacroTheme.accent, in: Circle()).padding(.trailing, 20)
                }
            }
            .onLongPressGesture(minimumDuration: 0.4) { UIImpactFeedbackGenerator(style: .light).impactOccurred(); menu?() }
            .simultaneousGesture(DragGesture(minimumDistance: 18)
                .onChanged { value in
                    guard reply != nil, abs(value.translation.width) > abs(value.translation.height) * 1.3 else { return }
                    // Rightward drags belong to back navigation, never to the message.
                    swipeOffset = min(0, max(-130, value.translation.width))
                    let crossed = swipeOffset < -75
                    if crossed != crossedThreshold { UIImpactFeedbackGenerator(style: .light).impactOccurred(); crossedThreshold = crossed }
                }
                .onEnded { value in
                    let activate = reply != nil && value.translation.width < -75
                        && abs(value.translation.width) > abs(value.translation.height) * 1.3
                    withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) { swipeOffset = 0; crossedThreshold = false }
                    if activate { reply?() }
                })
            .accessibilityAction(named: "Reply") { reply?() }
            .accessibilityAction(named: "Message actions") { menu?() }
    }
    private var richText: AttributedString {
        let text = MentionCodec.markdownForDisplay(in: projection.body)
        var attributed = (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
        // Highlight the rendered mention labels without exposing wire-format tags.
        for token in MentionCodec.tokens(in: message.content) {
            if let range = attributed.range(of: token.token.displayText) {
                attributed[range].foregroundColor = MacroTheme.accent
                attributed[range].backgroundColor = MacroTheme.accent.opacity(0.09)
            }
        }
        return attributed
    }
}
