import SwiftUI
import UniformTypeIdentifiers

struct NativeTaskComposer: View {
    let session: NativeSession
    let service: WorkspaceService
    var parentID: String? = nil
    var onCreated: (WorkspaceItem) -> Void = { _ in }
    private let persistsDraft: Bool
    private let draftAccount: String
    @State private var draft: NativeTaskComposerDraft
    @State private var createMore = false
    @State private var busy = false
    @State private var error: String?
    @State private var picker: PropertyPicker?
    @State private var tags: [NativeTaskTag] = []
    @State private var people: [MentionCandidate] = []
    @State private var photos: [String: URL] = [:]
    @State private var loadingOptions = false
    @State private var optionError: String?
    @State private var query = ""
    @State private var files = false
    @State private var uploading = false
    @State private var draftWasSubmitted = false
    @State private var continuedTask: WorkspaceItem?
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focus: Field?
    private enum Field { case title, body }
    private enum PropertyPicker: String { case status = "Status", priority = "Priority", assignees = "Assignees", dueDate = "Due Date", tags = "Tags" }

    init(session: NativeSession, service: WorkspaceService, parentID: String? = nil, initialTitle: String? = nil, initialContent: String? = nil, onCreated: @escaping (WorkspaceItem) -> Void = { _ in }) {
        self.session = session; self.service = service; self.parentID = parentID; self.onCreated = onCreated
        persistsDraft = initialTitle == nil && initialContent == nil
        draftAccount = NativeTaskDraftCache.account(session)
        var value = NativeTaskComposerDraft.initial(userID: session.userID ?? "", displayName: session.displayName ?? session.email)
        if initialTitle == nil && initialContent == nil, !session.isDemo, let cached = NativeTaskDraftCache.read(account: NativeTaskDraftCache.account(session)) { value = cached }
        if let initialTitle { value.title = initialTitle }; if let initialContent { value.content = initialContent }
        _draft = State(initialValue: value)
    }

    var body: some View {
        NativeFloatingDrawer(onDismiss: close, maximumHeightFraction: 0.92, dismissDisabled: busy || uploading) {
            if let picker { propertyPicker(picker) }
            else { NativeDrawerScrollView { composer.padding(.vertical, 17) } }
        }
        .fileImporter(isPresented: $files, allowedContentTypes: [.image, .movie], allowsMultipleSelection: true) { result in
            switch result { case .success(let urls): Task { await attach(urls) }; case .failure(let error): self.error = error.localizedDescription }
        }
        .task { if draft.title.isEmpty { focus = .title } }
        .task(id: draft) {
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            saveDraft()
        }
        .task(id: draft.assignees.map(\.id)) {
            guard !session.isDemo else { return }
            photos = (try? await MessagingAPI(baseURL: session.environment.gatewayURL, tokenProvider: { [session] in try await session.macroAPIToken() }).userPhotos(userIDs: draft.assignees.map(\.id))) ?? photos
        }
        .onDisappear { saveDraft() }
        .fullScreenCover(item: $continuedTask, onDismiss: { dismiss() }) { item in
            NavigationStack {
                NativeTaskDetailView(item: item, session: session, service: service)
                    .toolbar { ToolbarItem(placement: .topBarLeading) { Button { continuedTask = nil } label: { MacroIcon(name: "caret-left", size: 21.25) }.accessibilityLabel("Back to tasks") } }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 17) {
            HStack(spacing: 4.25) {
                Button { Task { await continueEditing() } } label: { MacroIcon(name: "arrows-out", size: 21.25).frame(width: 38.25, height: 38.25) }
                    .accessibilityLabel("Continue editing in full screen").accessibilityIdentifier("task-continue-editing")
                Spacer()
                if !draft.isEmpty {
                    Button("Clear Draft") { draft = NativeTaskComposerDraft.initial(userID: session.userID ?? "", displayName: session.displayName ?? session.email); error = nil; focus = .title }
                        .font(.system(size: 12.75)).padding(.horizontal, 12.75).frame(height: 34)
                        .background(MacroTheme.background, in: RoundedRectangle(cornerRadius: 8.5))
                        .overlay(RoundedRectangle(cornerRadius: 8.5).strokeBorder(.primary.opacity(0.14), lineWidth: 0.7))
                        .accessibilityIdentifier("task-clear-draft")
                }
                Button(action: close) { MacroIcon(name: "x", size: 21.25).frame(width: 38.25, height: 38.25) }
                    .accessibilityLabel("Close").accessibilityIdentifier("task-create-close")
            }.buttonStyle(.plain).disabled(busy || uploading)
            Group {
                VStack(alignment: .leading, spacing: 17) {
                    TextField("New task", text: $draft.title, axis: .vertical).font(.system(size: 21.25, weight: .medium))
                        .lineLimit(1...4).frame(minHeight: 29.75, alignment: .topLeading)
                        .focused($focus, equals: .title).accessibilityIdentifier("create-name")
                    ZStack(alignment: .topLeading) {
                        TextEditor(text: $draft.content).font(.system(size: 15.9375)).scrollContentBackground(.hidden)
                            .frame(height: 102).focused($focus, equals: .body).accessibilityIdentifier("create-content")
                            .padding(.horizontal, -5.3125).padding(.top, -8.5)
                        if draft.content.isEmpty { Text("Add description...").font(.system(size: 15.9375)).foregroundStyle(.tertiary).allowsHitTesting(false) }
                    }.frame(minHeight: 102, alignment: .topLeading)
                    ForEach(draft.media) { media in
                        HStack {
                            if !media.isVideo && !session.isDemo { AsyncImage(url: media.url) { image in image.resizable().scaledToFit().frame(maxHeight: 127.5) } placeholder: { ProgressView() } }
                            else { Label(media.name, systemImage: media.isVideo ? "video" : "photo").font(.system(size: 13.8125)) }
                            Spacer()
                            Button { draft.media.removeAll { $0.id == media.id } } label: { MacroIcon(name: "x", size: 17).frame(width: 29.75, height: 29.75) }.accessibilityLabel("Remove " + media.name)
                        }
                    }
                    propertyChips.padding(.top, 8.5).padding(.horizontal, -7.4375)
                }.padding(.horizontal, 8.5)
            }
            if let error { Text(error).font(.system(size: 13.8125)).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading) }
            footer
        }.padding(.horizontal, 17).foregroundStyle(.primary).disabled(busy)
    }

    private var propertyChips: some View {
        NativePropertyPillLayout(spacing: 8.5) {
            chip((WorkspaceTaskStatus(rawValue: draft.status) ?? .notStarted).title.capitalized, icon: "circle", id: "task-status") { open(.status) }
            chip(draft.priority.map { priorityName($0) } ?? "Priority", icon: draft.priority == nil ? "circle-dashed" : "flag", id: "task-priority") { open(.priority) }
            Button { open(.assignees) } label: {
                HStack(spacing: 5.3125) {
                    if let assignee = draft.assignees.first { AvatarView(name: assignee.name, size: 17, photoURL: photos[assignee.id]); Text(assignee.name.components(separatedBy: " ").first ?? assignee.name).lineLimit(1); if draft.assignees.count > 1 { Text("+\(draft.assignees.count - 1)") }; MacroIcon(name: "caret-down", size: 12.75) }
                    else { MacroIcon(name: "user", size: 17); Text("Assignees") }
                }.font(.system(size: 12.75, weight: .medium)).padding(.horizontal, 8.5).frame(height: 25.5).background(.primary.opacity(0.015), in: Capsule()).overlay(Capsule().strokeBorder(.primary.opacity(0.08), lineWidth: 1))
            }.buttonStyle(.plain).accessibilityIdentifier("task-assignees")
            chip(draft.dueDate?.formatted(.dateTime.month(.abbreviated).day()) ?? "Due Date", icon: draft.dueDate == nil ? "circle-dashed" : "calendar-blank", id: "task-due-date") { open(.dueDate) }
            chip(draft.tags.isEmpty ? "Tags" : draft.tags.map(\.name).joined(separator: ", "), icon: draft.tags.isEmpty ? "circle-dashed" : "tag", id: "task-tags") { open(.tags) }
        }
    }
    private func chip(_ title: String, icon: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { HStack(spacing: 4.25) { MacroIcon(name: icon, size: 12.75).foregroundStyle(id == "task-status" ? Color.green : Color.secondary); Text(title).lineLimit(1); MacroIcon(name: "caret-down", size: 12.75) }.font(.system(size: 12.75, weight: .medium)).padding(.horizontal, 8.5).frame(height: 25.5).background(.primary.opacity(0.015), in: Capsule()).overlay(Capsule().strokeBorder(.primary.opacity(0.08), lineWidth: 1)) }
            .buttonStyle(.plain).accessibilityIdentifier(id)
    }
    private var footer: some View {
        HStack(spacing: 12.75) {
            Button { focus = nil; files = true } label: {
                if uploading { ProgressView().frame(width: 38.25, height: 38.25) }
                else { MacroIcon(name: "paperclip", size: 21.25).frame(width: 38.25, height: 38.25) }
            }.buttonStyle(.plain).disabled(uploading).accessibilityLabel("Attach image or video").accessibilityIdentifier("task-attach")
            Spacer(minLength: 0)
            Button { createMore.toggle() } label: {
                HStack(spacing: 6.375) {
                    Capsule().fill(createMore ? MacroTheme.accent : Color.primary.opacity(0.16)).frame(width: 31.875, height: 19.125)
                        .overlay(alignment: createMore ? .trailing : .leading) { Circle().fill(MacroTheme.background).frame(width: 14.875, height: 14.875).padding(2.125) }
                    Text("Create More").font(.system(size: 12.75)).foregroundStyle(.secondary)
                }
            }.buttonStyle(.plain).accessibilityValue(createMore ? "On" : "Off").accessibilityIdentifier("task-create-more")
            Button { Task { await create() } } label: {
                HStack(spacing: 12.75) {
                    if busy { ProgressView() }
                    Text("Create Task").lineLimit(1)
                    HStack(spacing: 4.25) { Text("⌘"); Text("↵") }
                        .font(.system(size: 10.625, weight: .regular)).padding(.horizontal, 6.375).padding(.vertical, 1.0625)
                        .overlay(RoundedRectangle(cornerRadius: 2.125).strokeBorder(.primary.opacity(0.3), lineWidth: 1))
                        .accessibilityHidden(true)
                }.font(.system(size: 14.875, weight: draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .medium : .semibold))
                    .padding(.horizontal, 8.5).frame(height: 38.25)
                    .foregroundStyle(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Color.secondary : Color.primary)
                    .background(.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8.5))
            }.buttonStyle(.plain).keyboardShortcut(.return, modifiers: .command)
                .disabled(busy || uploading || draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("task-create-submit")
        }
    }

    private func propertyPicker(_ selection: PropertyPicker) -> some View {
        VStack(spacing: 12.75) {
            HStack {
                Button { picker = nil; query = "" } label: { MacroIcon(name: "caret-left", size: 23.375).frame(width: 42.5, height: 42.5) }.accessibilityLabel("Back to task")
                Text(selection.rawValue).font(.system(size: 17, weight: .medium)); Spacer()
                Button { picker = nil; query = "" } label: { MacroIcon(name: "x", size: 21.25).frame(width: 38.25, height: 38.25) }.accessibilityLabel("Close properties")
            }.buttonStyle(.plain).padding(.horizontal, 12.75)
            NativeDrawerScrollView(reservedHeight: 55.25) {
                VStack(spacing: 0) {
                    if selection == .assignees || selection == .tags { TextField("Search " + selection.rawValue.lowercased(), text: $query).font(.system(size: 15.9375)).padding(14.875).background(.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12.75)).padding(.bottom, 8.5) }
                    if loadingOptions { ProgressView().padding() }
                    if let optionError { Text(optionError).font(.system(size: 13.8125)).foregroundStyle(.red).padding(12.75) }
                    switch selection {
                    case .status:
                        ForEach(WorkspaceTaskStatus.allCases) { status in option(status.title.capitalized, selected: draft.status == status.rawValue) { draft.status = status.rawValue; picker = nil } }
                    case .priority:
                        option("No priority", selected: draft.priority == nil) { draft.priority = nil; picker = nil }
                        ForEach(1...4, id: \.self) { value in option(priorityName(value), selected: draft.priority == value) { draft.priority = value; picker = nil } }
                    case .assignees:
                        let all = [NativeTaskAssignee(id: session.userID ?? "", name: session.displayName ?? session.email)] + people.filter { $0.id != session.userID }.map { NativeTaskAssignee(id: $0.id, name: $0.title) }
                        ForEach(all.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) || $0.id.localizedCaseInsensitiveContains(query) }) { person in
                            option(person.name, selected: draft.assignees.contains { $0.id == person.id }) {
                                if draft.assignees.contains(where: { $0.id == person.id }) { draft.assignees.removeAll { $0.id == person.id } }
                                else { draft.assignees.append(person) }
                            }
                        }
                    case .dueDate:
                        option("No due date", selected: draft.dueDate == nil) { draft.dueDate = nil; picker = nil }
                        option("Today", selected: draft.dueDate.map { Calendar.current.isDateInToday($0) } ?? false) { draft.dueDate = Calendar.current.startOfDay(for: Date()); picker = nil }
                        option("Tomorrow", selected: draft.dueDate.map { Calendar.current.isDateInTomorrow($0) } ?? false) { draft.dueDate = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: Date())); picker = nil }
                        DatePicker("Due Date", selection: Binding(get: { draft.dueDate ?? Date() }, set: { draft.dueDate = Calendar.current.startOfDay(for: $0) }), displayedComponents: .date).datePickerStyle(.graphical).padding(.horizontal, 4.25)
                    case .tags:
                        if tags.isEmpty && !loadingOptions { Text("No tags yet").font(.system(size: 14.875)).foregroundStyle(.secondary).padding(21.25) }
                        ForEach(tags.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) }) { tag in
                            option(tag.name, selected: draft.tags.contains { $0.id == tag.id }) {
                                if draft.tags.contains(where: { $0.id == tag.id }) { draft.tags.removeAll { $0.id == tag.id } }
                                else { draft.tags.append(tag) }
                            }
                        }
                    }
                }.padding(.horizontal, 21.25)
            }
        }.foregroundStyle(.primary)
    }
    private func option(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { HStack { Text(title).font(.system(size: 14.875)); Spacer(); if selected { MacroIcon(name: "check", size: 19.125) } }.padding(.horizontal, 12.75).frame(minHeight: 46.75).contentShape(Rectangle()).background(selected ? Color.primary.opacity(0.05) : .clear, in: RoundedRectangle(cornerRadius: 21.25)) }
            .buttonStyle(.plain).accessibilityAddTraits(selected ? [.isSelected] : [])
    }
    private func priorityName(_ value: Int) -> String { [1: "Low", 2: "Medium", 3: "High", 4: "Urgent"][value] ?? "Priority" }
    private func open(_ value: PropertyPicker) { focus = nil; picker = value; query = ""; Task { await loadOptions(value) } }
    private func loadOptions(_ value: PropertyPicker) async {
        guard value == .assignees || value == .tags else { return }
        loadingOptions = true; optionError = nil; defer { loadingOptions = false }
        if value == .assignees { people = await MentionSearchService(session: session).search("").filter { $0.kind == .user }; return }
        if session.isDemo { tags = [NativeTaskTag(id: "fixture-tag", definitionID: "fixture-tags", name: "Design", scope: "Personal")]; return }
        do {
            let request = URLRequest(url: session.environment.gatewayURL.appendingPathComponent("dss/properties/tags"))
            let raw = try JSONDecoder().decode(WorkspaceJSON.self, from: await session.authenticatedData(for: request))
            tags = raw.array.flatMap { set in set["options"].array.compactMap { option in
                guard let id = option["id"].string, let definitionID = option["propertyDefinitionId"].string ?? set["definition"]["id"].string,
                      let name = option["value"]["value"].string else { return nil }
                return NativeTaskTag(id: id, definitionID: definitionID, name: name, scope: set["scope"]["type"].string ?? "")
            } }
        } catch { optionError = error.localizedDescription }
    }
    private func saveDraft() {
        guard persistsDraft, !draftWasSubmitted, !session.isDemo, NativeTaskDraftCache.account(session) == draftAccount else { return }
        NativeTaskDraftCache.write(draft, account: draftAccount)
    }
    private func close() { guard !busy, !uploading else { return }; saveDraft(); dismiss() }
    private func create() async {
        guard !busy, !uploading else { return }; busy = true; error = nil
        defer { busy = false }
        do {
            let item = try await service.createDocument(name: draft.title, markdown: draft.markdown, projectID: parentID, isTask: true, taskProperties: draft.properties)
            if persistsDraft { NativeTaskDraftCache.clear(account: draftAccount) }
            draftWasSubmitted = !createMore
            draft.title = ""; draft.content = ""; draft.media = []
            if createMore { focus = .title } else { onCreated(item); dismiss() }
        } catch { self.error = error.localizedDescription }
    }
    private func continueEditing() async {
        guard !busy, !uploading else { return }; busy = true; error = nil; focus = nil
        defer { busy = false }
        do {
            let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
            let item = try await service.createDocument(name: title.isEmpty ? "New task" : title, markdown: draft.markdown, projectID: parentID, isTask: true, taskProperties: draft.properties)
            if persistsDraft { NativeTaskDraftCache.clear(account: draftAccount) }
            draftWasSubmitted = true; continuedTask = item
        } catch { self.error = error.localizedDescription }
    }
    private func attach(_ urls: [URL]) async {
        guard !uploading else { return }; uploading = true; error = nil; defer { uploading = false }
        do {
            for url in urls {
                let file = try await Task.detached { try ChannelUploadFile.importFile(url) }.value
                defer { file.remove() }
                let uploaded = try await ChannelAttachmentUploader(session: session).uploadPromptFile(file)
                draft.media.append(NativeTaskMedia(id: UUID().uuidString, name: file.name, url: uploaded, isVideo: file.contentType.hasPrefix("video/")))
            }
        } catch { self.error = error.localizedDescription }
    }
}

/// The production property pills wrap naturally instead of becoming a scrolling form row.
struct NativePropertyPillLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize { frames(width: proposal.width ?? 360, subviews: subviews).size }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = frames(width: bounds.width, subviews: subviews)
        for (index, frame) in result.frames.enumerated() { subviews[index].place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), proposal: ProposedViewSize(frame.size)) }
    }
    private func frames(width: CGFloat, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0; var frames: [CGRect] = []
        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0 && x + size.width > width { x = 0; y += line + spacing; line = 0 }
            frames.append(CGRect(x: x, y: y, width: min(width, size.width), height: size.height)); x += size.width + spacing; line = max(line, size.height)
        }
        return (CGSize(width: width, height: y + line), frames)
    }
}
