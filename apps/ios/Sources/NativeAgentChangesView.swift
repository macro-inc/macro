import SwiftUI

struct NativeAgentChangesView: View {
    let model: NativeAgentStore
    @Environment(\.dismiss) private var dismiss
    @State private var patchLines: [String] = []
    @State private var error: String?
    @State private var loading = true

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if let changeset = model.changes?.changeset {
                        HStack(spacing: 10) {
                            Text("\(changeset.files.count) files").foregroundStyle(.secondary)
                            Text("+\(changeset.additions)").foregroundStyle(.green)
                            Text("−\(changeset.deletions)").foregroundStyle(.red)
                        }.font(.system(size: 13, design: .monospaced))
                        ForEach(changeset.files) { file in
                            HStack {
                                Image(systemName: "doc")
                                VStack(alignment: .leading) {
                                    Text(file.path).font(.system(size: 13, design: .monospaced))
                                    if file.binary { Text("Binary file").font(.caption).foregroundStyle(.secondary) }
                                    else if file.patchOmitted { Text("Diff omitted from this capture").font(.caption).foregroundStyle(.secondary) }
                                }
                                Spacer()
                                Text("+\(file.additions)").foregroundStyle(.green)
                                Text("−\(file.deletions)").foregroundStyle(.red)
                            }.font(.caption)
                        }
                        if changeset.truncated { Text("This capture includes a partial diff.").font(.caption).foregroundStyle(.secondary) }
                        Divider()
                    }
                    if loading { ProgressView("Loading changes…") }
                    if let error { Text(error).font(.caption).foregroundStyle(.secondary); Button("Try again") { Task { await load() } } }
                    ForEach(patchLines.indices, id: \.self) { index in
                        let line = patchLines[index]
                        Text(line.isEmpty ? " " : line).font(.system(size: 11, design: .monospaced)).textSelection(.enabled)
                            .foregroundStyle(line.hasPrefix("+") && !line.hasPrefix("+++") ? Color.green : line.hasPrefix("-") && !line.hasPrefix("---") ? .red : .primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }.padding(16)
            }.accessibilityIdentifier("agent-changes-diff")
                .navigationTitle("Review changes").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .task { await load() }
                .onChange(of: model.record?.id) { _, id in if id == nil { patchLines = []; dismiss() } }
        }
    }
    private func load() async {
        loading = true; defer { loading = false }
        do {
            let patch = try await model.loadPatch()
            patchLines = await Task.detached(priority: .userInitiated) { patch.components(separatedBy: "\n") }.value
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}
