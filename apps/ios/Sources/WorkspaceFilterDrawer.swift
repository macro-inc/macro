import SwiftUI

struct WorkspaceFilterDrawer: View {
    @Binding var unreadOnly: Bool
    @Binding var favoriteOnly: Bool
    @Binding var kind: WorkspaceKind?
    var isRecent: Bool
    let onFileScope: (WorkspaceCollection) -> Void
    let onClose: () -> Void
    @State private var expanded: Set<String> = ["Status"]
    var body: some View {
        NativeFloatingDrawer(onDismiss: onClose) {
            NativeDrawerScrollView {
                VStack(alignment: .leading, spacing: 12.75) {
                    HStack {
                        Text("Filters").font(.system(size: 19, weight: .medium)); Spacer()
                        Button(action: onClose) { MacroIcon(name: "x", size: 17).frame(width: 32, height: 32).contentShape(Rectangle()) }
                            .accessibilityLabel("Close filters").accessibilityIdentifier("workspace-filters-close")
                    }
                    if isRecent {
                        Text("Recent shows files ordered by their latest edits. Choose a file view to filter its results.").font(.system(size: 14.875)).foregroundStyle(.secondary)
                        row("My Files", selected: false) { onFileScope(.myFiles) }
                        row("Shared with me", selected: false) { onFileScope(.sharedFiles) }
                    } else {
                        section("Status") {
                            row("Unread only", selected: unreadOnly) { unreadOnly.toggle() }.accessibilityIdentifier("workspace-filter-unread")
                            row("Favorites only", selected: favoriteOnly) { favoriteOnly.toggle() }.accessibilityIdentifier("workspace-filter-favorites")
                        }
                        section("Type") {
                            row("All types", selected: kind == nil) { kind = nil }
                            ForEach([WorkspaceKind.document, .task, .folder, .channel, .email, .agent, .calendar, .call], id: \.self) { value in
                                row(value.rawValue.capitalized, selected: kind == value) { kind = value }
                            }
                        }
                        Button("Clear all filters") { unreadOnly = false; favoriteOnly = false; kind = nil }
                            .font(.system(size: 14.875)).foregroundStyle(.red).frame(maxWidth: .infinity, minHeight: 46.75, alignment: .leading).contentShape(Rectangle())
                    }
                }.buttonStyle(.plain).padding(.horizontal, 25.5)
            }
        }
    }
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            Button { if !expanded.insert(title).inserted { expanded.remove(title) } } label: {
                HStack { Text(title).font(.system(size: 14.875, weight: .medium)); Spacer(); MacroIcon(name: expanded.contains(title) ? "caret-down" : "caret-right", size: 15) }
                    .frame(minHeight: 46.75).contentShape(Rectangle())
            }.accessibilityIdentifier("workspace-filter-section-" + title.lowercased())
            if expanded.contains(title) { content() }
        }
    }
    private func row(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12.75) {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle").font(.system(size: 17)).foregroundStyle(selected ? MacroTheme.accent : .secondary)
                Text(title).font(.system(size: 14.875)); Spacer()
            }.padding(.leading, 12.75).frame(minHeight: 46.75).contentShape(Rectangle())
        }.accessibilityAddTraits(selected ? .isSelected : [])
    }
}
