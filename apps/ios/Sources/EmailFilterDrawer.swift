import SwiftUI

/// The mobile EmailFilterDrawer hierarchy uses Macro's shared floating drawer.
struct EmailFilterDrawer: View {
    @Bindable var store: EmailStore
    let onClose: () -> Void
    @State private var expanded: Set<String> = ["Inboxes", "Status"]
    private var active: Bool {
        store.query.inboxID != nil || store.query.unreadOnly || store.query.readOnly || store.query.done != nil || store.query.calendarOnly || !store.query.attachmentKinds.isEmpty
    }
    var body: some View {
        NativeFloatingDrawer(onDismiss: onClose, handleBottomPadding: 4) {
            VStack(spacing: 0) {
                HStack {
                    Text("Email filters").font(.system(size: 18, weight: .semibold))
                    Spacer()
                    Button(action: onClose) { MacroIcon(name: "x", size: 16).frame(width: 32, height: 32).background(.primary.opacity(0.06), in: Circle()) }
                        .accessibilityLabel("Close filters").accessibilityIdentifier("email-filters-done")
                }.padding(.horizontal, 24).padding(.bottom, 12)
                NativeDrawerScrollView(reservedHeight: active ? 96 : 44) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(store.query.tab == .scheduled ? "Inboxes" : "Filters").font(.system(size: 12)).foregroundStyle(.secondary).padding(.horizontal, 24).padding(.top, 16)
                        section("Inboxes") {
                            option("All inboxes", selected: store.query.inboxID == nil, icon: "envelope") { store.query.inboxID = nil }
                            ForEach(store.inboxes.sorted { $0.email_address < $1.email_address }) { inbox in
                                option(inbox.email_address + (inbox.needs_reauth ? " · Reconnect" : ""), selected: store.query.inboxID == inbox.id, icon: "envelope") { store.query.inboxID = inbox.id }
                            }
                        }
                        if store.query.tab != .scheduled {
                            section("Status") {
                                option("Unread", selected: store.query.unreadOnly) { store.query.unreadOnly = true; store.query.readOnly = false }
                                option("Read", selected: store.query.readOnly) { store.query.unreadOnly = false; store.query.readOnly = true }
                                option("All", selected: !store.query.unreadOnly && !store.query.readOnly) { store.query.unreadOnly = false; store.query.readOnly = false }
                            }
                            section("Done") {
                                option("Not done", selected: store.query.done == false) { store.query.done = false }
                                option("Done", selected: store.query.done == true) { store.query.done = true }
                                option("All", selected: store.query.done == nil) { store.query.done = nil }
                            }
                            section("Attachments") {
                                ForEach(EmailAttachmentKind.allCases, id: \.self) { kind in
                                    option(kind.rawValue, selected: store.query.attachmentKinds.contains(kind), icon: kind == .document ? "files" : "file") {
                                        if store.query.attachmentKinds.contains(kind) { store.query.attachmentKinds.remove(kind) } else { store.query.attachmentKinds.insert(kind) }
                                    }
                                }
                            }
                            section("Calendar") {
                                option("Has calendar invite", selected: store.query.calendarOnly, icon: "calendar") { store.query.calendarOnly.toggle() }
                            }
                        }
                    }
                }
                if active {
                    Button("Clear all") {
                        let tab = store.query.tab
                        store.query = EmailQuery(tab: tab)
                    }.foregroundStyle(.red).font(.system(size: 14)).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal, 40).padding(.top, 8).padding(.bottom, 16).accessibilityIdentifier("email-clear-filters")
                }
            }.buttonStyle(.plain)
        }
    }

    private func section<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 4) {
            Button {
                if expanded.contains(label) { expanded.remove(label) } else { expanded.insert(label) }
            } label: {
                HStack { Text(label).fontWeight(.medium); Spacer(); MacroIcon(name: expanded.contains(label) ? "caret-up" : "caret-down", size: 16).foregroundStyle(.secondary) }
                    .padding(.horizontal, 16).frame(minHeight: 44).background(expanded.contains(label) ? Color.primary.opacity(0.05) : .clear, in: RoundedRectangle(cornerRadius: 10)).contentShape(Rectangle())
            }.accessibilityIdentifier("email-filter-section-" + label.lowercased())
            if expanded.contains(label) { content() }
        }.font(.system(size: 15)).padding(.horizontal, 8)
    }
    private func option(_ title: String, selected: Bool, icon: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                if let icon { MacroIcon(name: icon, size: 20).foregroundStyle(.secondary) }
                Text(title).lineLimit(1); Spacer()
                Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.accentColor).opacity(selected ? 1 : 0).frame(width: 20)
            }.padding(.horizontal, 16).frame(minHeight: 44).contentShape(Rectangle())
        }.accessibilityAddTraits(selected ? .isSelected : [])
    }
}
