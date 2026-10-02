import SwiftUI

/// Production opens a full-page message draft; a channel is created only when Send is pressed.
struct NewConversationSheet: View {
    let session: NativeSession
    let store: ChatStore
    let opened: (Channel) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = []
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?
    @State private var showChannel = false
    @State private var showAttachments = false
    @State private var editorHeight: CGFloat = 48
    private let draftKey = "new-message"
    private var draft: Binding<String> { Binding(get: { store.drafts[draftKey] ?? "" }, set: { store.setDraft($0, channelID: draftKey) }) }
    private var files: [ChannelDraftAttachment] { store.draftAttachments[draftKey] ?? [] }
    private var canSend: Bool { !busy && !selected.isEmpty && (!draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !files.isEmpty) }
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8.5) {
                Button { dismiss() } label: { MacroIcon(name: "caret-left", size: 21.25).frame(width: 42.5, height: 42.5).background(.ultraThinMaterial, in: Circle()) }.accessibilityLabel("Back").accessibilityIdentifier("new-message-back")
                Text(selected.isEmpty ? "Draft message" : selected.count == 1 ? "DM with " + store.name(for: selected.first!) : name.isEmpty ? "Group chat" : name)
                    .font(.system(size: 15.94, weight: .medium)).lineLimit(1)
                Text("Draft").font(.system(size: 12.75)).foregroundStyle(.secondary).padding(.horizontal, 6).padding(.vertical, 3).background(.primary.opacity(0.05), in: Capsule())
                Spacer(minLength: 0)
                Button { showChannel = true } label: { MacroIcon(name: "hash-straight", size: 21.25).frame(width: 42.5, height: 42.5).background(.ultraThinMaterial, in: Circle()) }.accessibilityLabel("New channel").accessibilityIdentifier("new-channel-open")
            }.buttonStyle(.plain).padding(.horizontal, 12).padding(.top, 6).padding(.bottom, 12)
            ScrollView {
                VStack(alignment: .leading, spacing: 17) {
                    if selected.count > 1 { TextField("Group chat name (optional)", text: $name).font(.system(size: 17)).padding(.horizontal, 4) }
                    NativeChannelRecipientPicker(session: session, store: store, selected: $selected, placeholder: "To: Macro users or email addresses")
                    HStack(alignment: .top, spacing: 12.75) {
                        MacroIcon(name: "info", size: 21.25).foregroundStyle(.secondary)
                        Text("Send a Macro message to anyone. Share your files, tasks, emails; you can @mention anything. If your message recipient is not already a Macro user, they will receive an email letting them know they received a message on Macro.")
                            .font(.system(size: 14.875)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }.padding(17).background(.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 17))
                }.padding(.horizontal, 17)
            }.scrollDismissesKeyboard(.interactively)
            VStack(alignment: .leading, spacing: 4) {
                if !files.isEmpty { ScrollView(.horizontal) { HStack { ForEach(files) { file in Button { store.setDraftAttachments(files.filter { $0.id != file.id }, channelID: draftKey) } label: { Label(file.title, systemImage: "xmark.circle.fill").font(.caption).padding(8) } } } } }
                NativeMentionEditor(wire: draft, height: $editorHeight, channel: Channel(id: draftKey, participants: selected.map { ChannelParticipant(userID: $0) }), store: store, session: session, plain: true, accessibilityID: "new-message-input", autoFocus: false)
                    .frame(height: max(46, min(180, editorHeight)))
                HStack {
                    Button { showAttachments = true } label: { MacroIcon(name: "paperclip", size: 24).frame(width: 42.5, height: 42.5) }.accessibilityLabel("Attach file")
                    Spacer()
                    Button { Task { await send() } } label: { if busy { ProgressView().frame(width: 42.5, height: 42.5) } else { MacroIcon(name: "arrow-up", size: 21.25).frame(width: 36, height: 36).background(canSend ? MacroTheme.accent : Color.primary.opacity(0.05), in: Circle()) } }
                        .disabled(!canSend).accessibilityLabel("Send message").accessibilityIdentifier("new-message-send")
                }.buttonStyle(.plain)
                if let error { Text(error).font(.caption).foregroundStyle(.red).padding(.horizontal, 12) }
            }.padding(6).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24)).overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(.primary.opacity(0.08))).padding(12)
        }.background(MacroTheme.background).toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(isPresented: $showChannel) { NativeChannelCreateDrawer(session: session, store: store, opened: opened).presentationBackground(.clear) }
            .sheet(isPresented: $showAttachments) { ChannelAttachmentPicker(session: session, alreadySelected: Set(files.map { $0.attachment.entityID })) { attachment, title in store.setDraftAttachments(files + [.init(attachment: attachment, title: title)], channelID: draftKey) } }
    }
    private func send() async {
        guard canSend else { return }; busy = true; error = nil; defer { busy = false }
        do {
            let id = try await ChannelManagementAPI(session: session).conversation(recipients: Array(selected), name: name)
            let channel = store.channels.first(where: { $0.id == id }) ?? Channel(id: id, name: name.isEmpty ? nil : name, channelType: selected.count == 1 ? "direct_message" : "private", participants: (Array(selected) + [store.userID]).map { ChannelParticipant(userID: $0) }, updatedAt: MessageDate.string(Date()))
            store.insertCreatedChannel(channel)
            guard store.send(draft.wrappedValue, channelID: id, attachments: files.map(\.attachment)) != nil else { throw WorkspaceError.server("The message could not be queued. Your draft is saved.") }
            store.setDraft("", channelID: draftKey); store.setDraftAttachments([], channelID: draftKey); opened(channel)
        } catch { self.error = error.localizedDescription }
    }
}

struct NativeChannelInviteDrawer: View {
    let session: NativeSession
    let store: ChatStore
    let channel: Channel
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = []
    @State private var busy = false
    @State private var error: String?
    @State private var copied = false
    var body: some View {
        NativeFloatingDrawer(onDismiss: { dismiss() }, dismissDisabled: busy) {
            NativeDrawerScrollView {
                VStack(alignment: .leading, spacing: 21.25) {
                    HStack { Text("Invite people").font(.system(size: 19.125, weight: .semibold)); Spacer(); Button { dismiss() } label: { MacroIcon(name: "x", size: 21.25).frame(width: 38.25, height: 38.25) }.accessibilityLabel("Close invite") }
                    NativeChannelRecipientPicker(session: session, store: store, selected: $selected, excluding: Set(channel.participants.map(\.userID)), placeholder: "name@company.com")
                    if let error { Text(error).font(.system(size: 13.8)).foregroundStyle(.red) }
                    Button { Task { await invite() } } label: { HStack { Spacer(); if busy { ProgressView() }; Text(selected.count > 1 ? "Add Participants" : "Add Participant"); Spacer() }.font(.system(size: 14.875, weight: .medium)).frame(height: 46.75).background(MacroTheme.accent.opacity(selected.isEmpty ? 0.08 : 1), in: Capsule()).foregroundStyle(selected.isEmpty ? Color.secondary : MacroTheme.background) }
                        .disabled(selected.isEmpty || busy).accessibilityIdentifier("channel-invite-submit")
                    if channel.channelType == "private" { Button { Task { await copyInvite() } } label: { Label(copied ? "Copied" : "Copy invite link", systemImage: copied ? "checkmark" : "link").font(.system(size: 14.875)).frame(maxWidth: .infinity).frame(height: 38.25) }.disabled(busy).accessibilityIdentifier("channel-invite-link") }
                }.padding(.horizontal, 25.5).padding(.bottom, 8.5).buttonStyle(.plain)
            }
        }
    }
    private func invite() async {
        busy = true; error = nil; defer { busy = false }
        do {
            try await ChannelManagementAPI(session: session).invite(channelID: channel.id, users: Array(selected))
            var updated = store.channels.first { $0.id == channel.id } ?? channel
            updated.participants += selected.filter { id in !updated.participants.contains { $0.userID == id } }.map { ChannelParticipant(userID: $0) }
            store.insertCreatedChannel(updated); dismiss(); if !session.isDemo { Task { await store.refreshChannels() } }
        } catch { self.error = error.localizedDescription }
    }
    private func copyInvite() async { busy = true; defer { busy = false }; do { UIPasteboard.general.url = try await ChannelManagementAPI(session: session).inviteURL(channelID: channel.id, webURL: session.environment.webURL); copied = true } catch { self.error = error.localizedDescription } }
}

/// Mounted inside the existing channel screen so its floating header and back gesture stay in place.
struct NativeChannelParticipantsView: View {
    let session: NativeSession
    let store: ChatStore
    let channel: Channel
    var onOpen: ((Channel) -> Void)? = nil
    @Environment(\.nativeChromeTop) private var chromeTop
    @State private var participants: [ChannelParticipant] = []
    @State private var loading = false
    @State private var error: String?
    @State private var query = ""
    @State private var invite = false
    @State private var copied = false
    @State private var opened: Channel?
    @State private var showOpened = false
    private var canManage: Bool { channel.isParticipant && ["private", "team"].contains(channel.channelType) }
    private var filtered: [ChannelParticipant] { participants.filter { query.isEmpty || store.name(for: $0.userID).localizedCaseInsensitiveContains(query) || $0.userID.localizedCaseInsensitiveContains(query) } }
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                HStack { Text("Participants").font(.system(size: 14.875, weight: .semibold)); Spacer(); if channel.channelType == "private" { Button { Task { await copyLink() } } label: { Label(copied ? "Copied" : "Copy invite link", systemImage: copied ? "checkmark" : "link").font(.system(size: 12.75)) }.disabled(loading) } }.padding(.horizontal, 25.5).padding(.vertical, 17)
                HStack(spacing: 12.75) { MacroIcon(name: "magnifying-glass", size: 17); TextField("Search participants", text: $query).font(.system(size: 14.875)).textInputAutocapitalization(.never).autocorrectionDisabled() }.padding(.horizontal, 17).padding(.vertical, 8.5).background(.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8.5)).overlay(RoundedRectangle(cornerRadius: 8.5).strokeBorder(.primary.opacity(0.08))).padding(.horizontal, 8.5).padding(.bottom, 12.75)
                if canManage { Button { invite = true } label: { Label("Add participants", systemImage: "person.badge.plus").font(.system(size: 14.875)).frame(maxWidth: .infinity).frame(height: 46.75).background(.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12.75)) }.padding(.horizontal, 8.5).padding(.bottom, 12.75).accessibilityIdentifier("channel-participants-add") }
                if loading && participants.isEmpty { ProgressView().padding(24) }
                ForEach(filtered, id: \.userID) { person in
                    HStack(spacing: 12.75) {
                        Button { Task { await open(person.userID) } } label: {
                            HStack(spacing: 12.75) {
                                AvatarView(name: store.name(for: person.userID), size: 42.5, photoURL: store.photos[person.userID])
                                VStack(alignment: .leading, spacing: 2) { Text(person.userID.replacingOccurrences(of: "macro|", with: "")).font(.system(size: 14.875, weight: .medium)).lineLimit(1); Text(person.role.capitalized).font(.system(size: 12.75)).foregroundStyle(.secondary) }
                                Spacer(minLength: 0)
                            }.contentShape(Rectangle())
                        }.disabled(person.userID == store.userID || person.userID.hasPrefix("bot|"))
                        if canManage && person.userID != store.userID && person.role != "owner" { Button { Task { await remove(person) } } label: { MacroIcon(name: "x", size: 17).frame(width: 34, height: 34) }.disabled(loading).accessibilityLabel("Remove " + store.name(for: person.userID)) }
                    }.padding(.horizontal, 25.5).padding(.vertical, 8.5)
                }
                if let error { NativeErrorRow(error: error) { Task { await load() } }.padding(17) }
            }.padding(.top, chromeTop + 64)
        }.buttonStyle(.plain).nativeChromeInset().refreshable { await load() }.task(id: channel.id) { await load() }
            .fullScreenCover(isPresented: $invite, onDismiss: { Task { await load() } }) { NativeChannelInviteDrawer(session: session, store: store, channel: Channel(id: channel.id, name: channel.name, channelType: channel.channelType, participants: participants)).presentationBackground(.clear) }
            .navigationDestination(isPresented: $showOpened) { if let opened { ConversationView(channel: opened, store: store, session: session) } }
    }
    private func load() async { participants = store.channels.first(where: { $0.id == channel.id })?.participants ?? channel.participants; loading = true; defer { loading = false }; do { participants = try await ChannelManagementAPI(session: session).participants(channel: store.channels.first(where: { $0.id == channel.id }) ?? channel); error = nil } catch { self.error = error.localizedDescription } }
    private func remove(_ person: ChannelParticipant) async { loading = true; defer { loading = false }; do { try await ChannelManagementAPI(session: session).remove(channelID: channel.id, participant: person); participants.removeAll { $0.userID == person.userID }; var updated = channel; updated.participants = participants; store.insertCreatedChannel(updated) } catch { self.error = error.localizedDescription } }
    private func copyLink() async { loading = true; defer { loading = false }; do { UIPasteboard.general.url = try await ChannelManagementAPI(session: session).inviteURL(channelID: channel.id, webURL: session.environment.webURL); copied = true } catch { self.error = error.localizedDescription } }
    private func open(_ id: String) async { loading = true; defer { loading = false }; do { let channelID = try await ChannelManagementAPI(session: session).conversation(recipients: [id]); let target = store.channels.first { $0.id == channelID } ?? Channel(id: channelID, channelType: "direct_message", participants: [store.userID, id].map { ChannelParticipant(userID: $0) }); store.insertCreatedChannel(target); if let onOpen { onOpen(target) } else { opened = target; showOpened = true } } catch { self.error = error.localizedDescription } }
}

struct ChannelInformationSheet: View {
    let session: NativeSession; let store: ChatStore; let channel: Channel
    var body: some View { NativeChannelInviteDrawer(session: session, store: store, channel: channel) }
}

private struct NativeChannelRecipientPicker: View {
    let session: NativeSession
    let store: ChatStore
    @Binding var selected: Set<String>
    var excluding: Set<String> = []
    var placeholder = "Macro users or email addresses"
    @State private var query = ""
    @State private var remote: [MentionCandidate] = []
    @State private var service: MentionSearchService?
    @FocusState private var focused: Bool
    private var candidates: [MentionCandidate] {
        let ids = Set(store.channels.flatMap { $0.participants.map(\.userID) }).union(store.names.keys)
        let cached = ids.map { MentionCandidate(kind: .user, id: $0, title: store.name(for: $0), subtitle: $0.replacingOccurrences(of: "macro|", with: "")) }
        return MentionCandidate.ranked(remote + cached, query: query).filter { $0.kind == .user && !$0.id.hasPrefix("bot|") && $0.id != store.userID && !excluding.contains($0.id) && !selected.contains($0.id) }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8.5) {
            if !selected.isEmpty { NativePropertyPillLayout(spacing: 8.5) { ForEach(selected.sorted(), id: \.self) { id in Button { selected.remove(id) } label: { HStack(spacing: 5) { AvatarView(name: store.name(for: id), size: 21.25, photoURL: store.photos[id]); Text(store.name(for: id)).lineLimit(1); MacroIcon(name: "x", size: 12.75) }.font(.system(size: 12.75)).padding(6).background(.primary.opacity(0.05), in: Capsule()) }.accessibilityLabel("Remove recipient " + store.name(for: id)) } } }
            TextField(placeholder, text: $query).font(.system(size: 14.875)).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().focused($focused).padding(12.75).background(.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 12.75)).overlay(RoundedRectangle(cornerRadius: 12.75).strokeBorder(.primary.opacity(0.08))).accessibilityIdentifier("channel-recipient-input")
                .onSubmit { if let id = ChannelManagementAPI.recipientID(query), !excluding.contains(id), id != store.userID { selected.insert(id); query = "" } }
            if focused || !query.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(candidates.prefix(8))) { person in Button { selected.insert(person.id); query = ""; focused = false } label: { HStack(spacing: 10) { AvatarView(name: person.title, size: 34, photoURL: store.photos[person.id]); VStack(alignment: .leading, spacing: 2) { Text(person.title).font(.system(size: 14.875)); Text(person.subtitle).font(.system(size: 12.75)).foregroundStyle(.secondary) }; Spacer() }.padding(.vertical, 8.5).contentShape(Rectangle()) }.accessibilityIdentifier("channel-recipient-" + person.id) }
                    if let id = ChannelManagementAPI.recipientID(query), !selected.contains(id), !excluding.contains(id), id != store.userID, !candidates.contains(where: { $0.id == id }) { Button { selected.insert(id); query = ""; focused = false } label: { Label("Add " + id.replacingOccurrences(of: "macro|", with: ""), systemImage: "plus").font(.system(size: 14.875)).padding(.vertical, 12.75) } }
                }
            }
        }.buttonStyle(.plain).task { service = MentionSearchService(session: session); remote = await service?.search("") ?? [] }
            .task(id: query) { guard !query.isEmpty else { return }; do { try await Task.sleep(for: .milliseconds(180)) } catch { return }; let result = await service?.search(query) ?? []; if !Task.isCancelled { remote = result } }
    }
}

struct NativeChannelCreateDrawer: View {
    let session: NativeSession; let store: ChatStore; let opened: (Channel) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var selected: Set<String> = []
    @State private var team: NativeChannelTeam?
    @State private var teamSelected = false
    @State private var autoJoin = false
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NativeFloatingDrawer(onDismiss: { dismiss() }, maximumHeightFraction: 0.9, dismissDisabled: busy) {
            NativeDrawerScrollView {
                VStack(alignment: .leading, spacing: 21.25) {
                    HStack { Text("New channel").font(.system(size: 19.125, weight: .semibold)); Spacer(); Button { dismiss() } label: { MacroIcon(name: "x", size: 21.25).frame(width: 38.25, height: 38.25) }.accessibilityLabel("Close new channel") }
                    if team != nil { HStack { mode("Private", active: !teamSelected) { teamSelected = false }; mode("Team", active: teamSelected) { teamSelected = true } }.padding(4).background(.primary.opacity(0.04), in: Capsule()) }
                    HStack { MacroIcon(name: "hash-straight", size: 21.25); TextField("Channel name", text: $name).font(.system(size: 17)).accessibilityIdentifier("new-channel-name") }.padding(12.75).background(.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 12.75))
                    Text("Invite people (optional)").font(.system(size: 14.875, weight: .medium))
                    NativeChannelRecipientPicker(session: session, store: store, selected: $selected)
                    if teamSelected, let team { Toggle("Auto-join team members", isOn: $autoJoin).font(.system(size: 14.875)); if autoJoin { ForEach(team.members, id: \.userID) { member in HStack { AvatarView(name: store.name(for: member.userID), size: 25.5); Text(store.name(for: member.userID)).font(.system(size: 14.875)); Spacer(); Text(member.role.capitalized).font(.system(size: 12.75)).foregroundStyle(.secondary) } } } }
                    if let error { Text(error).font(.caption).foregroundStyle(.red) }
                    Text(teamSelected ? "Members of your team can see this channel." : "Only people you invite can see this channel.").font(.system(size: 12.75)).foregroundStyle(.secondary)
                    Button { Task { await create() } } label: { HStack { Spacer(); if busy { ProgressView() }; Text("Create Channel"); Spacer() }.font(.system(size: 14.875, weight: .medium)).frame(height: 46.75).background(MacroTheme.accent.opacity(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.08 : 1), in: Capsule()).foregroundStyle(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Color.secondary : MacroTheme.background) }.disabled(busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("new-channel-create")
                }.padding(.horizontal, 25.5).padding(.bottom, 8.5).buttonStyle(.plain)
            }
        }.task { do { team = try await ChannelManagementAPI(session: session).currentTeam() } catch { /* Private channel creation remains available if team metadata is offline. */ } }
    }
    private func mode(_ text: String, active: Bool, action: @escaping () -> Void) -> some View { Button(action: action) { Text(text).font(.system(size: 14.875, weight: .medium)).frame(maxWidth: .infinity).frame(height: 38.25).background(active ? Color.primary.opacity(0.08) : .clear, in: Capsule()) } }
    private func create() async {
        busy = true; error = nil; defer { busy = false }
        do { let id = try await ChannelManagementAPI(session: session).create(name: name, recipients: Array(selected), teamID: teamSelected ? team?.team.id : nil, autoJoin: autoJoin)
            let ids = selected.union([store.userID]).union(teamSelected && autoJoin ? Set(team?.members.map(\.userID) ?? []) : [])
            let channel = Channel(id: id, name: name.trimmingCharacters(in: .whitespacesAndNewlines), channelType: teamSelected ? "team" : "private", participants: ids.sorted().map { ChannelParticipant(userID: $0, role: $0 == store.userID ? "owner" : "member") }, updatedAt: MessageDate.string(Date()))
            store.insertCreatedChannel(channel); opened(channel)
        } catch { self.error = error.localizedDescription }
    }
}

struct EditMessageSheet: View {
    let message: ChatMessage
    let session: NativeSession
    let store: ChatStore
    @State private var text: String
    @State private var editorHeight: CGFloat = 200
    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss
    init(message: ChatMessage, session: NativeSession, store: ChatStore) {
        self.message = message; self.session = session; self.store = store
        _text = State(initialValue: message.content)
    }
    var body: some View {
        NavigationStack {
            Form { NativeMentionEditor(wire: $text, height: $editorHeight, channel: store.channels.first(where: { $0.id == message.channelID }) ?? Channel(id: message.channelID), store: store).frame(height: max(160, editorHeight)); if let error { Text(error).foregroundStyle(.red) } }
                .navigationTitle("Edit message").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                }
        }
    }
    private func save() async {
        busy = true
        do {
            let edited = try await ChatActions(session: session).edit(message: message, content: text)
            store.receive(MessageEvent(parent: edited.parent, actor: edited.senderID, change: MessageChange(type: "message_updated", message: edited)))
            dismiss()
        } catch { self.error = error.localizedDescription }
        busy = false
    }
}
