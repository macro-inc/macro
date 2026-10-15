import SwiftUI

@MainActor @Observable
final class NativeTaskDetailStore {
    private(set) var item: WorkspaceItem
    private(set) var isLoading = false
    private(set) var isSaving = false
    var error: String?
    private let service: WorkspaceService
    private var revision = 0

    init(item: WorkspaceItem, service: WorkspaceService) {
        self.item = item
        self.service = service
    }

    func refresh() async {
        guard !isSaving else { return }
        let expectedRevision = revision
        isLoading = true
        defer { isLoading = false }
        do {
            let fresh = try await service.item(item)
            guard revision == expectedRevision else { return }
            item = fresh
            error = nil
        } catch {
            if revision == expectedRevision { self.error = error.localizedDescription }
        }
    }

    func setStatus(_ status: WorkspaceTaskStatus) async {
        guard !isSaving else { return }
        revision += 1
        isSaving = true
        error = nil
        defer { isSaving = false }
        do {
            try await service.setTaskStatus(item: item, status: status)
            item.status = status.title
            if let index = item.properties.firstIndex(where: { $0.definitionID == WorkspaceProperty.statusID }) {
                item.properties[index].value = .object(["type": .string("SelectOption"), "value": .array([.string(status.optionID)])])
            }
        } catch { self.error = error.localizedDescription }
    }

    func rename(_ name: String) async {
        guard !isSaving else { return }
        revision += 1
        isSaving = true
        error = nil
        defer { isSaving = false }
        do {
            try await service.rename(item: item, name: name)
            item.title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch { self.error = error.localizedDescription }
    }
}

struct NativeTaskDetailView: View {
    let session: NativeSession
    var onChange: (WorkspaceItem) -> Void
    @State private var model: NativeTaskDetailStore
    @State private var showRename = false
    @State private var name = ""

    init(item: WorkspaceItem, session: NativeSession, service: WorkspaceService? = nil, onChange: @escaping (WorkspaceItem) -> Void = { _ in }) {
        self.session = session
        self.onChange = onChange
        _model = State(initialValue: NativeTaskDetailStore(item: item, service: service ?? WorkspaceService(session: session)))
    }

    var body: some View {
        List {
            Section {
                HStack(alignment: .top, spacing: 14) {
                    Button {
                        Task { await model.setStatus(model.item.isCompleted ? .notStarted : .completed) }
                    } label: {
                        Image(systemName: model.item.isCompleted ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 25, weight: .regular))
                            .foregroundStyle(model.item.isCompleted ? Color.green : Color.secondary)
                            .frame(width: 36, height: 40)
                    }
                    .buttonStyle(.plain)
                    .disabled(model.isSaving)
                    .accessibilityLabel(model.item.isCompleted ? "Reopen task" : "Complete task")
                    .accessibilityValue(model.item.isCompleted ? "Completed" : "Incomplete")
                    .accessibilityIdentifier("task-completion")
                    Text(model.item.title)
                        .font(.title3.weight(.semibold))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 7)
                        .accessibilityIdentifier("task-title")
                }
                Menu {
                    ForEach(WorkspaceTaskStatus.allCases, id: \.self) { status in
                        Button {
                            Task { await model.setStatus(status) }
                        } label: {
                            if model.item.status == status.title { Label(status.title, systemImage: "checkmark") }
                            else { Text(status.title) }
                        }
                    }
                } label: {
                    HStack {
                        Text("Status").foregroundStyle(.primary)
                        Spacer()
                        Text(model.item.status ?? (model.item.isCompleted ? "Completed" : "Not started"))
                        Image(systemName: "chevron.up.chevron.down").font(.caption)
                    }
                }
                .disabled(model.isSaving)
                .accessibilityIdentifier("task-status")
                if model.isSaving { HStack { ProgressView(); Text("Saving…").foregroundStyle(.secondary) } }
            }
            if let error = model.error {
                Section {
                    Text(error).foregroundStyle(.red).accessibilityIdentifier("task-error")
                    Button("Refresh task") { Task { await model.refresh() } }.disabled(model.isLoading || model.isSaving)
                }
            }
            if !model.item.subtitle.isEmpty {
                Section("Summary") {
                    Text(MentionCodec.displayText(in: model.item.subtitle)).textSelection(.enabled)
                }
            }
            let properties = model.item.properties.filter { $0.definitionID != WorkspaceProperty.statusID }
            if !properties.isEmpty {
                Section("Properties") {
                    ForEach(properties) { property in
                        LabeledContent(property.name) {
                            Text(property.displayValue.isEmpty ? "Not set" : property.displayValue)
                                .multilineTextAlignment(.trailing).textSelection(.enabled)
                        }
                    }
                }
            }
            Section {
                NavigationLink {
                    WebWorkspaceView(session: session, url: session.environment.webURL.appendingPathComponent("task/\(model.item.id)"))
                        .navigationTitle(model.item.title)
                } label: {
                    Label("Open task notes", systemImage: "doc.text")
                }.accessibilityIdentifier("task-notes")
            }
            if let ownerID = model.item.ownerID {
                Section {
                    LabeledContent("Owner", value: ownerID.components(separatedBy: "|").last ?? ownerID)
                    if !model.item.updatedAt.isEmpty {
                        LabeledContent("Updated") { Text(model.item.date, format: .dateTime.month(.abbreviated).day().year().hour().minute()) }
                    }
                }.foregroundStyle(.secondary)
            }
        }
        .font(.subheadline)
        .listStyle(.insetGrouped)
        .navigationTitle("Task")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Rename", systemImage: "pencil") { name = model.item.title; showRename = true }
                    .disabled(model.isSaving)
                    .accessibilityIdentifier("task-rename")
            }
        }
        .alert("Rename task", isPresented: $showRename) {
            TextField("Task name", text: $name)
            Button("Cancel", role: .cancel) { }
            Button("Save") { Task { await model.rename(name) } }
                .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .task { await model.refresh() }
        .refreshable { await model.refresh() }
        .onChange(of: model.item) { _, item in onChange(item) }
    }
}
