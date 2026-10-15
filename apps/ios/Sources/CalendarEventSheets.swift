import SwiftUI

struct NativeCalendarEditor: View {
    let store: NativeCalendarStore
    let entry: NativeCalendarEntry?
    @State private var draft: NativeCalendarDraft
    @State private var pane: Pane?
    @State private var zoneQuery = ""
    @Environment(\.dismiss) private var dismiss
    private enum Pane: String { case calendar = "Calendar", zone = "Time zone", recurrence = "Repeat", guests = "Guests", location = "Location", reminder = "Notifications", availability = "Show as", visibility = "Visibility", scope = "Apply changes to" }
    private var editingSeries: Bool { entry?.isRecurring == true && draft.scope == "all" }

    init(store: NativeCalendarStore, entry: NativeCalendarEntry?, date: Date) {
        self.store = store; self.entry = entry
        _draft = State(initialValue: entry.map { NativeCalendarDraft(entry: $0, calendar: store.calendar) }
            ?? NativeCalendarDraft(date: date, calendarID: store.writableSources.first?.id ?? "", calendar: store.calendar))
    }

    var body: some View {
        NativeFloatingDrawer(onDismiss: { dismiss() }, maximumHeightFraction: 0.92, dismissDisabled: store.isSaving, handleBottomPadding: 4) {
            HStack {
                if pane != nil {
                    Button { pane = nil } label: { MacroIcon(name: "caret-left", size: 21).frame(width: 44, height: 44) }.accessibilityLabel("Back to event")
                    Text(pane!.rawValue).font(.system(size: 17, weight: .medium))
                }
                Spacer()
                Button { dismiss() } label: { MacroIcon(name: "x", size: 21).frame(width: 46.75, height: 46.75).background(.primary.opacity(0.06), in: Circle()) }
                    .accessibilityLabel("Close event editor").accessibilityIdentifier("calendar-editor-close")
            }.buttonStyle(.plain).padding(.horizontal, 25.5).padding(.bottom, 17).disabled(store.isSaving)
            NativeDrawerScrollView(reservedHeight: 64) {
                if let pane { picker(pane).padding(.horizontal, 25.5) }
                else { form.padding(.horizontal, 25.5) }
            }
        }
        .foregroundStyle(.primary)
        .onChange(of: draft.allDay) { _, allDay in
            if allDay {
                draft.start = store.calendar.startOfDay(for: draft.start)
                draft.end = max(draft.start, store.calendar.startOfDay(for: draft.end))
            } else {
                draft.start = store.calendar.date(bySettingHour: 9, minute: 0, second: 0, of: draft.start) ?? draft.start
                draft.end = max(draft.start.addingTimeInterval(3_600), draft.end)
            }
        }
        .onChange(of: draft.start) { _, date in if draft.end <= date { draft.end = draft.allDay ? date : date.addingTimeInterval(3_600) } }
        .environment(\.calendar, store.calendar)
        .environment(\.timeZone, draft.allDay ? store.calendar.timeZone : TimeZone(identifier: draft.timeZone) ?? store.calendar.timeZone)
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                DatePicker("Starts", selection: $draft.start, displayedComponents: draft.allDay ? [.date] : [.date, .hourAndMinute])
                    .disabled(editingSeries).accessibilityIdentifier("calendar-start")
                DatePicker(draft.allDay ? "Last day" : "Ends", selection: $draft.end, in: draft.start..., displayedComponents: draft.allDay ? [.date] : [.date, .hourAndMinute])
                    .disabled(editingSeries).accessibilityIdentifier("calendar-end")
                HStack(spacing: 8) {
                    Button { draft.allDay.toggle() } label: {
                        HStack(spacing: 6) { MacroIcon(name: draft.allDay ? "check-square" : "square", size: 16); Text("All day") }
                    }.buttonStyle(.plain).disabled(editingSeries).accessibilityIdentifier("calendar-all-day").accessibilityValue(draft.allDay ? "On" : "Off")
                    Spacer()
                    if !draft.allDay { Button { pane = .zone } label: { Text(draft.timeZone.replacingOccurrences(of: "_", with: " ")).lineLimit(1); MacroIcon(name: "caret-down", size: 12) }.buttonStyle(.plain).disabled(editingSeries) }
                }.font(.system(size: 12.75)).foregroundStyle(.secondary)
            }.font(.system(size: 14.875))
            VStack(alignment: .leading, spacing: 8) {
                TextField("New event", text: $draft.title, axis: .vertical).font(.system(size: 19.125, weight: .semibold))
                    .lineLimit(1...4).accessibilityIdentifier("calendar-event-title")
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $draft.notes).font(.system(size: 14.875)).scrollContentBackground(.hidden).frame(height: 51)
                        .padding(.horizontal, -5).padding(.top, -8).accessibilityLabel("Description").accessibilityIdentifier("calendar-notes")
                    if draft.notes.isEmpty { Text("Add description...").font(.system(size: 14.875)).foregroundStyle(.tertiary).allowsHitTesting(false) }
                }
            }
            NativePropertyPillLayout(spacing: 8.5) {
                pill(store.source(id: draft.calendarID)?.name ?? "Calendar", icon: "calendar-blank", pane: .calendar).disabled(entry != nil)
                if entry == nil { pill(draft.recurrence.isEmpty ? "Does not repeat" : NativeCalendarDetailFormatting.recurrence(["RRULE:FREQ=" + draft.recurrence]), icon: "arrow-clockwise", pane: .recurrence) }
                pill(draft.guests.isEmpty ? "Guests" : "Guests (\(draft.guests.split(separator: ",").count))", icon: "users", pane: .guests).disabled(entry.map { !NativeCalendarDraft.canEditGuests($0) } ?? false)
                if entry?.item.event.conferenceUrl == nil {
                    Button { draft.addGoogleMeet.toggle() } label: { pillLabel(draft.addGoogleMeet ? "Google Meet" : "Add video meeting", icon: "video-camera") }
                        .buttonStyle(.plain).accessibilityLabel("Add Google Meet").accessibilityAddTraits(draft.addGoogleMeet ? .isSelected : [])
                }
                pill(draft.location.isEmpty ? "Location" : draft.location, icon: "map-pin", pane: .location).accessibilityIdentifier("calendar-location-pill")
                pill(draft.reminderMinutes == -1 ? "Calendar default" : draft.reminderMinutes == -2 ? "No notifications" : NativeCalendarDetailFormatting.reminder(.init(minutes: draft.reminderMinutes)), icon: "bell-simple", pane: .reminder)
                pill(draft.availability == "transparent" ? "Free" : "Busy", icon: "circle", pane: .availability)
                pill(draft.visibility == "default" ? "Default visibility" : draft.visibility.capitalized, icon: "lock", pane: .visibility)
                if entry?.isRecurring == true { pill(draft.scope == "all" ? "All events" : "Only this event", icon: "arrow-clockwise", pane: .scope) }
            }
            if store.writableSources.isEmpty { Text("Connect a writable calendar to create events.").font(.system(size: 12.75)).foregroundStyle(.secondary) }
            if let error = store.mutationError { Text(error).font(.system(size: 14.875)).foregroundStyle(.red).accessibilityIdentifier("calendar-save-error") }
            HStack {
                Spacer()
                Button { Task { if await store.save(draft, editing: entry) { dismiss() } } } label: {
                    HStack { if store.isSaving { ProgressView() }; Text(entry == nil ? "Create event" : "Save") }
                        .font(.system(size: 14.875, weight: .medium)).padding(.horizontal, 13).frame(height: 38.25)
                        .foregroundStyle(MacroTheme.background).background(MacroTheme.accent, in: RoundedRectangle(cornerRadius: 8.5))
                }.buttonStyle(.plain).disabled(store.isSaving || draft.calendarID.isEmpty || draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("Save event").accessibilityIdentifier("calendar-save")
            }
        }.disabled(store.isSaving)
    }

    private func pill(_ title: String, icon: String, pane: Pane) -> some View {
        Button { self.pane = pane } label: { pillLabel(title, icon: icon) }.buttonStyle(.plain)
    }
    private func pillLabel(_ title: String, icon: String) -> some View {
        HStack(spacing: 4.25) { MacroIcon(name: icon, size: 12.75); Text(title).lineLimit(1); MacroIcon(name: "caret-down", size: 12.75) }
            .font(.system(size: 12.75, weight: .medium)).foregroundStyle(.secondary).padding(.horizontal, 8.5).frame(height: 25.5)
            .background(.primary.opacity(0.05), in: Capsule()).overlay(Capsule().strokeBorder(.primary.opacity(0.05), lineWidth: 1))
    }
    @ViewBuilder private func picker(_ pane: Pane) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            switch pane {
            case .calendar:
                ForEach(store.writableSources) { source in choice(source.name + " · " + source.emailAddress, selected: source.id == draft.calendarID) { draft.calendarID = source.id } }
            case .zone:
                TextField("City or time zone", text: $zoneQuery).textInputAutocapitalization(.never).padding(12).background(.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
                LazyVStack(spacing: 0) {
                    ForEach(TimeZone.knownTimeZoneIdentifiers.filter { zoneQuery.isEmpty || $0.replacingOccurrences(of: "_", with: " ").localizedCaseInsensitiveContains(zoneQuery) }, id: \.self) { zone in
                        choice(zone.replacingOccurrences(of: "_", with: " "), selected: zone == draft.timeZone) { draft.timeZone = zone }
                    }
                }
            case .recurrence:
                ForEach([("", "Does not repeat"), ("DAILY", "Every day"), ("WEEKLY", "Every week"), ("MONTHLY", "Every month"), ("YEARLY", "Every year")], id: \.0) { value, title in choice(title, selected: draft.recurrence == value) { draft.recurrence = value } }
            case .guests:
                TextField("Guest email addresses", text: $draft.guests, axis: .vertical).textInputAutocapitalization(.never).keyboardType(.emailAddress).autocorrectionDisabled().lineLimit(2...8).accessibilityIdentifier("calendar-guests")
                Text("Separate addresses with commas. Saving sends invitations to new guests.").font(.system(size: 12.75)).foregroundStyle(.secondary)
                choice("Add guests", selected: false) { }
            case .location:
                TextField("Location or video link", text: $draft.location, axis: .vertical).lineLimit(2...8).accessibilityIdentifier("calendar-location")
                choice("Save location", selected: false) { }
            case .reminder:
                ForEach([-1, -2, 0, 5, 10, 15, 30, 60, 1440, 10080], id: \.self) { minutes in
                    choice(minutes == -1 ? "Calendar default" : minutes == -2 ? "None" : NativeCalendarDetailFormatting.reminder(.init(minutes: minutes)), selected: draft.reminderMinutes == minutes) { draft.reminderMinutes = minutes }
                }
            case .availability:
                choice("Busy", selected: draft.availability == "opaque") { draft.availability = "opaque" }
                choice("Free", selected: draft.availability == "transparent") { draft.availability = "transparent" }
            case .visibility:
                ForEach([("default", "Calendar default"), ("private", "Private"), ("public", "Public")], id: \.0) { value, title in choice(title, selected: draft.visibility == value) { draft.visibility = value } }
            case .scope:
                choice("Only this event", selected: draft.scope == "this_event") { draft.scope = "this_event" }
                choice("All events", selected: draft.scope == "all") { draft.scope = "all" }
                Text("Series edits update details and guests. Choose only this event to change its date or time.").font(.system(size: 12.75)).foregroundStyle(.secondary)
            }
        }.font(.system(size: 14.875))
    }
    private func choice(_ title: String, selected: Bool, _ action: @escaping () -> Void) -> some View {
        Button { action(); pane = nil } label: {
            HStack { Text(title); Spacer(); if selected { MacroIcon(name: "check", size: 19) } }.padding(.horizontal, 8).frame(minHeight: 46.75).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
}
