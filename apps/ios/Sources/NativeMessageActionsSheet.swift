import SwiftUI
import UIKit

/// Matches the mobile channel ActionDrawer: pinned quick reactions and scrollable actions.
struct NativeMessageActionsSheet: View {
    let message: ChatMessage
    let userID: String
    let webURL: URL
    var canWrite = true
    let onReply: () -> Void
    let onReact: (String) -> Void
    let onCreateTask: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var showsEmojiSearch = false
    @State private var query = ""
    @FocusState private var searching: Bool
    private let quick = ["❤️", "👍", "👎", "😂", "😡"]
    private var editable: Bool { NativeMessageActionPolicy.canEdit(message, userID: userID, canWrite: canWrite) }
    private var deletable: Bool { NativeMessageActionPolicy.canDelete(message, userID: userID, canWrite: canWrite) }
    var body: some View {
        NativeFloatingDrawer(onDismiss: { dismiss() }) {
            if showsEmojiSearch { emojiSearch.frame(height: 500) }
            else {
                if canWrite && !message.isDeleted {
                    HStack(spacing: 4) {
                        ForEach(quick, id: \.self) { emoji in
                            Button { choose { onReact(emoji) } } label: {
                                Text(emoji).font(.system(size: 29.75)).frame(width: 51, height: 51)
                                    .background(Color.primary.opacity(0.06), in: Circle())
                            }.accessibilityLabel("React " + emoji).accessibilityIdentifier("message-react-" + emoji)
                            Spacer(minLength: 0)
                        }
                        Button { showsEmojiSearch = true; searching = true } label: {
                            MacroIcon(name: "smiley", size: 29.75).foregroundStyle(.secondary).frame(width: 51, height: 51)
                                .background(Color.primary.opacity(0.06), in: Circle())
                        }.accessibilityLabel("More reactions").accessibilityIdentifier("message-more-reactions")
                    }.buttonStyle(.plain).padding(.horizontal, 12).padding(.bottom, 16)
                }
                NativeDrawerScrollView(reservedHeight: canWrite && !message.isDeleted ? 64 : 0) {
                    VStack(spacing: 12) {
                        VStack(spacing: 0) {
                            if canWrite && !message.isDeleted { row("Reply", icon: "arrow-bend-up-left", id: "reply", action: onReply) }
                            if !message.isDeleted && !message.content.isEmpty {
                                row("Copy message text", icon: "copy", id: "copy-text") { UIPasteboard.general.string = MentionCodec.displayText(in: message.content) }
                            }
                            row("Copy link", icon: "link", id: "copy-link") { UIPasteboard.general.url = NativeMessageActionPolicy.link(message, webURL: webURL) }
                            row("Create task", icon: "check-square", id: "create-task", action: onCreateTask)
                            if editable { row("Edit", icon: "pencil", id: "edit", action: onEdit) }
                        }.padding(4).background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 24))
                        if deletable {
                            row("Delete", icon: "trash", id: "delete", destructive: true, action: onDelete)
                                .padding(4).background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 24))
                        }
                    }.padding(.horizontal, 12)
                }
            }
        }
    }

    private func row(_ title: String, icon: String? = nil, system: String? = nil, id: String, destructive: Bool = false, action: @escaping () -> Void) -> some View {
        Button { choose(action) } label: {
            HStack(spacing: 12) {
                if let icon { MacroIcon(name: icon, size: 21.25) }
                else if let system { Image(systemName: system).font(.system(size: 19)).frame(width: 20) }
                Text(title).font(.system(size: 15.9375)); Spacer()
            }.foregroundStyle(destructive ? Color.red : .primary).padding(.horizontal, 12).frame(minHeight: 46.75).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier("message-action-" + id)
    }

    private func choose(_ action: @escaping () -> Void) {
        dismiss()
        // Let the dismissal complete before Reply/Edit/Create present their native sheet.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: action)
    }

    private var emojiSearch: some View {
        VStack(spacing: 12) {
            HStack {
                Button { showsEmojiSearch = false; searching = false } label: { Image(systemName: "chevron.left").frame(width: 36, height: 40) }.accessibilityLabel("Back to message actions")
                TextField("Search emojis", text: $query).font(.system(size: 15)).textInputAutocapitalization(.never).autocorrectionDisabled().focused($searching).accessibilityIdentifier("message-emoji-search")
            }.padding(.horizontal, 16)
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 7), spacing: 6) {
                    ForEach(NativeReactionEmoji.matching(query)) { value in
                        Button { choose { onReact(value.emoji) } } label: { Text(value.emoji).font(.system(size: 30)).frame(maxWidth: .infinity).frame(height: 45) }
                            .buttonStyle(.plain).accessibilityLabel(value.terms.first ?? value.emoji).accessibilityIdentifier("message-emoji-" + value.id)
                    }
                }.padding(.horizontal, 12)
            }.scrollDismissesKeyboard(.interactively)
        }
    }
}

private struct NativeReactionEmoji: Decodable, Identifiable {
    var id: String
    var emoji: String
    var terms: [String]
    static let all: [Self] = {
        guard let data = NSDataAsset(name: "message-emoji")?.data else { return [] }
        return (try? JSONDecoder().decode([Self].self, from: data)) ?? []
    }()
    static func matching(_ query: String) -> [Self] {
        let tokens = query.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
        guard !tokens.isEmpty else { return all }
        return all.filter { item in tokens.allSatisfy { token in item.emoji.contains(token) || item.terms.contains { $0.contains(token) } } }
    }
}

struct NativeMessageTaskSheet: View {
    let message: ChatMessage
    let channelName: String
    let session: NativeSession
    var onCreated: (WorkspaceItem) -> Void = { _ in }
    var body: some View {
        NativeTaskComposer(session: session, service: WorkspaceService(session: session),
            initialTitle: NativeMessageActionPolicy.taskTitle(message),
            initialContent: NativeMessageActionPolicy.taskReference(message, channelName: channelName), onCreated: onCreated)
    }
}
