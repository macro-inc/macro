import SwiftUI

/// The existing Automation and Reminder dialogs, using the same fields and schedule semantics.
struct NativeScheduleComposer: View {
    let kind: NativeScheduleKind
    let session: NativeSession
    let store: ChatStore
    let onClose: () -> Void
    let onCreated: (String) -> Void
    @State private var draft: NativeScheduleDraft
    @State private var busy = false
    @State private var error: String?
    @State private var promptHeight: CGFloat = 88
    @ScaledMetric(relativeTo: .body) private var remPoints: CGFloat = 17
    private var rem: CGFloat { remPoints / 16 }

    init(kind: NativeScheduleKind, session: NativeSession, store: ChatStore, onClose: @escaping () -> Void, onCreated: @escaping (String) -> Void) {
        self.kind = kind; self.session = session; self.store = store; self.onClose = onClose; self.onCreated = onCreated
        var value = NativeScheduleDraft()
        if kind == .reminder { value.frequency = .once }
        if kind == .automation, let data = store.drafts["automation-new"]?.data(using: .utf8), let saved = try? JSONDecoder().decode(NativeScheduleDraft.self, from: data) { value = saved }
        _draft = State(initialValue: value)
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.opacity(0.18).ignoresSafeArea().contentShape(Rectangle()).onTapGesture { if !busy { onClose() } }
                VStack(spacing: 0) {
                    HStack {
                        Text(kind == .automation ? "New Automation" : "New reminder").font(.system(size: kind == .automation ? 14 * rem : 18 * rem, weight: .semibold))
                        Spacer()
                        Button { onClose() } label: { MacroIcon(name: "x", size: 18 * rem).frame(width: 30 * rem, height: 30 * rem) }.disabled(busy).accessibilityLabel("Close " + kind.rawValue)
                    }.padding(.horizontal, 12 * rem).padding(.vertical, 8 * rem)
                    Divider()
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12 * rem) {
                            if kind == .automation {
                                fieldLabel("Name")
                                TextField("e.g. Morning standup summary", text: $draft.name).font(.system(size: 14 * rem)).modifier(ScheduleField())
                                    .accessibilityIdentifier("automation-name")
                                fieldLabel("Instructions")
                                NativeMentionEditor(wire: $draft.prompt, height: $promptHeight, channel: Channel(id: "automation-new"), store: store, session: session, plain: true, includeGroups: false, accessibilityID: "automation-prompt")
                                    .frame(height: max(88, min(160, promptHeight))).modifier(ScheduleField())
                            } else {
                                Text("Choose when you’d like to be reminded.").font(.system(size: 14 * rem)).foregroundStyle(.secondary)
                                TextField("What's the reminder?", text: $draft.prompt, axis: .vertical).font(.system(size: 15 * rem)).lineLimit(1...3).modifier(ScheduleField()).accessibilityIdentifier("reminder-description")
                            }
                            scheduleFields
                            if let error { Text(error).font(.system(size: 12 * rem)).foregroundStyle(.red).accessibilityIdentifier("schedule-error") }
                        }.padding(12 * rem)
                    }.frame(maxHeight: geometry.size.height * 0.6)
                    Divider()
                    HStack(spacing: 8 * rem) {
                        Spacer()
                        Button("Cancel") { onClose() }.disabled(busy).padding(.horizontal, 12).frame(height: 34)
                        Button { Task { await create() } } label: {
                            HStack { if busy { ProgressView().controlSize(.small) }; Text(kind == .automation ? "Create" : "Set reminder") }
                                .padding(.horizontal, 12).frame(height: 34).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
                                .foregroundStyle(draft.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Color.secondary : Color.primary)
                        }.disabled(busy || draft.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("schedule-submit")
                    }.font(.system(size: 13 * rem, weight: .medium)).padding(.horizontal, 12 * rem).padding(.vertical, 8 * rem)
                }.fixedSize(horizontal: false, vertical: true).frame(maxWidth: 440 * rem)
                    .background(MacroTheme.background, in: RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.primary.opacity(0.12)))
                    .padding(16).buttonStyle(.plain).disabled(busy)
            }
        }.onChange(of: draft) { _, value in
            guard kind == .automation, let data = try? JSONEncoder().encode(value), let text = String(data: data, encoding: .utf8) else { return }
            store.setDraft(text, channelID: "automation-new")
        }
    }

    private var scheduleFields: some View {
        VStack(alignment: .leading, spacing: 12 * rem) {
            Text(kind == .automation ? "Schedule" : "Repeat").font(.system(size: 14 * rem, weight: .semibold))
            HStack(spacing: 4 * rem) {
                if kind == .reminder { frequency(.once, "Does not repeat") }
                frequency(.week, kind == .automation ? "Every week" : "Weekly")
                frequency(.month, kind == .automation ? "Every month" : "Monthly")
            }
            if draft.frequency == .once {
                DatePicker("Date and time", selection: $draft.onceDate, displayedComponents: [.date, .hourAndMinute]).font(.system(size: 14 * rem)).labelsHidden()
                Text(TimeZone.current.identifier.replacingOccurrences(of: "_", with: " ")).font(.system(size: 12 * rem)).foregroundStyle(.secondary)
            } else {
                if draft.frequency == .week {
                    fieldLabel("Days")
                    HStack(spacing: 4) {
                        ForEach(Array(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].enumerated()), id: \.offset) { index, day in
                            Button { let value = index + 1; if draft.days.contains(value) { draft.days.remove(value) } else { draft.days.insert(value) } } label: {
                                Text(day).font(.system(size: 12 * rem)).frame(maxWidth: .infinity).frame(height: 30).background(draft.days.contains(index + 1) ? MacroTheme.accent.opacity(0.15) : Color.clear, in: RoundedRectangle(cornerRadius: 5))
                                    .foregroundStyle(draft.days.contains(index + 1) ? MacroTheme.accent : .secondary).overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.primary.opacity(0.1)))
                            }.accessibilityLabel(day).accessibilityAddTraits(draft.days.contains(index + 1) ? .isSelected : [])
                        }
                    }
                } else {
                    HStack { fieldLabel("Day of Month"); Spacer(); Picker("Day of Month", selection: $draft.monthDay) { ForEach(1...31, id: \.self) { Text(String($0)).tag($0) } }.pickerStyle(.menu) }
                }
                DatePicker("Time", selection: Binding(get: {
                    Calendar.current.date(bySettingHour: draft.hour, minute: draft.minute, second: 0, of: Date()) ?? Date()
                }, set: { date in draft.hour = Calendar.current.component(.hour, from: date); draft.minute = Calendar.current.component(.minute, from: date) }), displayedComponents: .hourAndMinute).font(.system(size: 14 * rem))
                if kind == .reminder {
                    Picker("Timezone", selection: $draft.timezone) { ForEach(TimeZone.knownTimeZoneIdentifiers, id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ")).tag($0) } }.font(.system(size: 12 * rem))
                } else { Text(draft.timezone.replacingOccurrences(of: "_", with: " ")).font(.system(size: 12 * rem)).foregroundStyle(.secondary) }
            }
        }.padding(kind == .automation ? 12 * rem : 0).overlay { if kind == .automation { RoundedRectangle(cornerRadius: 5).strokeBorder(Color.primary.opacity(0.1)) } }
    }
    private func fieldLabel(_ value: String) -> some View { Text(value).font(.system(size: 12 * rem, weight: .medium)).foregroundStyle(.secondary) }
    private func frequency(_ value: NativeScheduleFrequency, _ text: String) -> some View {
        Button { draft.frequency = value } label: {
            Text(text).font(.system(size: 12 * rem)).padding(.horizontal, 8).padding(.vertical, 7).background(draft.frequency == value ? MacroTheme.accent.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 5))
                .foregroundStyle(draft.frequency == value ? MacroTheme.accent : .secondary).overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Color.primary.opacity(0.12)))
        }.accessibilityAddTraits(draft.frequency == value ? .isSelected : []).accessibilityIdentifier("schedule-frequency-" + value.rawValue)
    }
    private func create() async {
        guard !busy else { return }; busy = true; error = nil; defer { busy = false }
        do {
            let id = try await NativeScheduleAPI(session: session).create(kind, draft: draft)
            if kind == .automation { store.setDraft("", channelID: "automation-new") }
            onCreated(id)
        } catch { self.error = error.localizedDescription }
    }
}

private struct ScheduleField: ViewModifier {
    func body(content: Content) -> some View { content.padding(.horizontal, 8).padding(.vertical, 6).background(Color.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 5)).overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Color.primary.opacity(0.1))) }
}
