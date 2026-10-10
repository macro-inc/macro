import SwiftUI

/// Choosing a date only edits the local draft. The upper send arrow is the delivery action.
struct EmailScheduleDrawer: View {
    let selection: Date?
    let onSelect: (Date?) -> Void
    let onClose: () -> Void
    @State private var custom: Date
    @State private var showsCustom = false
    init(selection: Date?, onSelect: @escaping (Date?) -> Void, onClose: @escaping () -> Void) {
        self.selection = selection; self.onSelect = onSelect; self.onClose = onClose
        _custom = State(initialValue: selection ?? Date().addingTimeInterval(3600))
    }
    var body: some View {
        NativeFloatingDrawer(onDismiss: onClose) {
            NativeDrawerScrollView {
                VStack(alignment: .leading, spacing: 12.75) {
                    HStack { Text("Send later").font(.system(size: 19, weight: .medium)); Spacer(); Button(action: onClose) { MacroIcon(name: "x", size: 17).frame(width: 30, height: 30) }.accessibilityLabel("Close schedule") }
                    preset("Later today", date: Date().addingTimeInterval(3600))
                    preset("Tomorrow morning", date: Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Calendar.current.date(byAdding: .day, value: 1, to: .now)!)!)
                    Button { showsCustom.toggle() } label: { Label("Pick a date and time", systemImage: "calendar").frame(maxWidth: .infinity, minHeight: 44, alignment: .leading) }
                    if showsCustom {
                        DatePicker("Send time", selection: $custom, in: Date()...)
                        Button("Use this time") { onSelect(custom) }.accessibilityIdentifier("email-schedule-confirm")
                    }
                    if selection != nil { Button("Send immediately instead") { onSelect(nil) }.foregroundStyle(.red).frame(minHeight: 44) }
                }.font(.system(size: 15)).buttonStyle(.plain).padding(.horizontal, 25.5)
            }
        }
    }
    private func preset(_ title: String, date: Date) -> some View {
        Button { onSelect(date) } label: {
            HStack { Text(title); Spacer(); Text(date.formatted(date: .abbreviated, time: .shortened)).font(.system(size: 13)).foregroundStyle(.secondary) }.frame(minHeight: 44).contentShape(Rectangle())
        }.accessibilityIdentifier("email-schedule-" + (title == "Later today" ? "later" : "tomorrow"))
    }
}
