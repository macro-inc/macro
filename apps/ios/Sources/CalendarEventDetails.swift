import SwiftUI
import UniformTypeIdentifiers

struct NativeCalendarDetails: View {
    let store: NativeCalendarStore
    let original: NativeCalendarEntry
    let session: NativeSession
    @State private var editing = false
    @State private var confirmDelete = false
    @State private var expandedGuests = true
    @State private var copied = false
    @State private var copiedCall = false
    @State private var photos: [String: URL] = [:]
    @State private var response: String?
    @State private var emailDraft: EmailComposition?
    @State private var emailStore: EmailStore
    @State private var actionError: String?
    @Environment(\.dismiss) private var dismiss
    @AppStorage("native-calendar-24-hour") private var use24Hour = false
    private var entry: NativeCalendarEntry { store.entry(id: original.id) ?? original }
    private var others: [NativeCalendarAttendee] { entry.item.event.attendees.filter { !$0.isSelf } }

    init(store: NativeCalendarStore, original: NativeCalendarEntry, session: NativeSession) {
        self.store = store; self.original = original; self.session = session
        _emailStore = State(initialValue: EmailStore(session: session))
    }

    var body: some View {
        NativeFloatingDrawer(onDismiss: { dismiss() }, dismissDisabled: store.isSaving, handleBottomPadding: 4) {
            VStack(spacing: 0) {
                header.padding(.horizontal, 25.5).padding(.bottom, 17)
                NativeDrawerScrollView(reservedHeight: 63.75) {
                    VStack(alignment: .leading, spacing: 0) {
                        if !others.isEmpty && others.allSatisfy({ $0.responseStatus == "declined" }) {
                            declinedNotice.padding(.horizontal, 12.75).padding(.bottom, 12.75)
                        }
                        details.padding(.horizontal, 17)
                        if !entry.item.event.attendees.isEmpty { guests.padding(.top, 8.5) }
                        if entry.item.event.attendees.contains(where: \.isSelf), !entry.isReadOnly { rsvp }
                        if let error = store.mutationError ?? actionError {
                            Text(error).font(.system(size: 13.8125)).foregroundStyle(.red).padding(.horizontal, 25.5).padding(.top, 12.75)
                        }
                    }
                }
            }.font(.system(size: 14.875)).foregroundStyle(.secondary)
        }
        .task(id: entry.eventID) {
            guard !session.isDemo else { return }
            photos = (try? await MessagingAPI(baseURL: session.environment.gatewayURL, tokenProvider: { [session] in try await session.macroAPIToken() }).userPhotos(userIDs: entry.item.event.attendees.map { "macro|" + $0.email })) ?? [:]
        }
        .fullScreenCover(isPresented: $editing) { NativeCalendarEditor(store: store, entry: entry, date: entry.interval.start).presentationBackground(.clear) }
        .fullScreenCover(item: $emailDraft) { EmailComposeView(draft: $0, workspace: emailStore) }
        .confirmationDialog(entry.isRecurring ? "Delete repeating event?" : "Delete event?", isPresented: $confirmDelete, titleVisibility: .visible) {
            if entry.isRecurring { Button("Delete only this event", role: .destructive) { delete(scope: "this_event") } }
            Button(entry.isRecurring ? "Delete all events in the series" : "Delete event", role: .destructive) { delete(scope: "all") }
            Button("Cancel", role: .cancel) { }
        } message: { Text("Delete “\(entry.title)”? Guests will be notified.") }
        .confirmationDialog("Respond to recurring event", isPresented: Binding(get: { response != nil }, set: { if !$0 { response = nil } }), titleVisibility: .visible) {
            Button("This event") { sendResponse(scope: "this_event") }
            Button("All events") { sendResponse(scope: "all") }
            Button("Cancel", role: .cancel) { response = nil }
        }
    }

    private var header: some View {
        HStack(spacing: 4.25) {
            action("x", label: "Close event details", id: "calendar-details-close") { dismiss() }
            Spacer()
            action(copied ? "check" : "link", label: copied ? "Copied event" : "Copy event", id: "calendar-copy") { copyEvent() }
            if store.canEdit(entry) {
                action("pencil-simple", label: "Edit event", id: "calendar-edit") { store.clearMutationError(); editing = true }
                action("trash", label: "Delete event", id: "calendar-delete") { confirmDelete = true }
            }
        }
    }
    private func action(_ icon: String, label: String, id: String, _ perform: @escaping () -> Void) -> some View {
        Button(action: perform) { MacroIcon(name: icon, size: 21.25).frame(width: 46.75, height: 46.75).background(.primary.opacity(0.06), in: Circle()) }
            .buttonStyle(.plain).foregroundStyle(.secondary).disabled(store.isSaving)
            .accessibilityLabel(label).accessibilityIdentifier(id)
    }
    private func row<Content: View>(_ icon: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 17) {
            MacroIcon(name: icon, size: 21.25).foregroundStyle(.tertiary).frame(width: 21.25).padding(.top, 2.125)
            content().frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private var details: some View {
        VStack(alignment: .leading, spacing: 21.25) {
            HStack(alignment: .top, spacing: 17) {
                RoundedRectangle(cornerRadius: 2.125).fill(NativeCalendarColors.color(store.source(id: entry.calendarID)?.color))
                    .frame(width: 17, height: 17).frame(width: 21.25, height: 21.25).padding(.top, 2.125)
                VStack(alignment: .leading, spacing: 4.25) {
                    Text(entry.title).font(.system(size: 19.125, weight: .semibold)).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                    Text(schedule).fixedSize(horizontal: false, vertical: true)
                    if entry.item.event.eventType == "out_of_office" { Text("Out of office").foregroundStyle(.tertiary) }
                    if entry.isRecurring { Text(NativeCalendarDetailFormatting.recurrence(entry.item.event.recurrenceLines)).foregroundStyle(.tertiary) }
                }
            }
            if let url = NativeCalendarDetailFormatting.safeURL(entry.item.event.conferenceUrl) {
                row("video-camera") {
                    HStack(spacing: 6.375) {
                        Link(destination: url) {
                            HStack(spacing: 6.375) { Text(entry.item.event.conferenceProvider == "google_meet" ? "Join Google Meet" : "Join meeting"); MacroIcon(name: "arrow-square-out", size: 14.875) }
                                .font(.system(size: 12.75, weight: .medium)).padding(.horizontal, 8.5).frame(height: 38.25)
                                .background(.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8.5))
                                .overlay(RoundedRectangle(cornerRadius: 8.5).strokeBorder(.primary.opacity(0.05), lineWidth: 1))
                        }.accessibilityIdentifier("calendar-join")
                        Button { UIPasteboard.general.url = url; copiedCall = true } label: {
                            MacroIcon(name: copiedCall ? "check" : "copy", size: 21.25).frame(width: 38.25, height: 38.25)
                        }.buttonStyle(.plain).accessibilityLabel(copiedCall ? "Copied call link" : "Copy call link")
                    }
                }
            }
            if !entry.isAllDay, let zone = entry.item.occurrence.time.zone {
                row("globe") { Text(NativeCalendarDetailFormatting.originalTime(entry.interval.start, zone: zone, use24Hour: use24Hour)).textSelection(.enabled) }
            }
            if let location = entry.location, !location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                row("map-pin") {
                    if let url = NativeCalendarDetailFormatting.safeURL(location) { Link(location, destination: url).tint(MacroTheme.accent) }
                    else { Text(location).textSelection(.enabled) }
                }
            }
            if let description = entry.description, !description.isEmpty {
                row("text-align-left") { NativeCalendarDescription(html: description).lineSpacing(5).textSelection(.enabled).accessibilityIdentifier("calendar-event-notes") }
            }
            let reminders = NativeCalendarDetailFormatting.reminders(entry, source: store.source(id: entry.calendarID))
            if !reminders.isEmpty {
                row("bell-simple") {
                    VStack(alignment: .leading, spacing: 2.125) {
                        ForEach(Array(reminders.enumerated()), id: \.offset) { _, reminder in
                            Text(NativeCalendarDetailFormatting.reminder(reminder))
                        }
                    }
                }
            }
            let attribution = NativeCalendarDetailFormatting.attribution(entry.item.event, source: store.source(id: entry.calendarID))
            row("calendar-blank") {
                VStack(alignment: .leading, spacing: 2.125) {
                    Text(store.source(id: entry.calendarID)?.name ?? "Calendar").textSelection(.enabled)
                    if let creator = attribution.creator { Text("Created by " + creator.label + (creator.isSelf ? " (you)" : "")).font(.system(size: 12.75)).foregroundStyle(.tertiary) }
                }
            }
            if let organizer = attribution.organizer {
                row("user") {
                    HStack(spacing: 17) {
                        AvatarView(name: organizer.label, size: 25.5, photoURL: organizer.email.flatMap { photos["macro|" + $0] })
                        VStack(alignment: .leading, spacing: 2.125) {
                            Text("Organizer").font(.system(size: 12.75)).foregroundStyle(.tertiary)
                            Text(organizer.label + (organizer.isSelf ? " (you)" : "")).lineLimit(1)
                        }
                    }
                }
            }
        }
    }
    private var guests: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4.25) {
                Button { expandedGuests.toggle() } label: {
                    HStack(spacing: 17) {
                        MacroIcon(name: "users", size: 21.25).foregroundStyle(.tertiary)
                        Text("\(entry.item.event.attendees.count) \(entry.item.event.attendees.count == 1 ? "attendee" : "attendees")")
                        MacroIcon(name: "caret-down", size: 12.75).rotationEffect(.degrees(expandedGuests ? 0 : -90))
                        Spacer(minLength: 0)
                    }.frame(minHeight: 55.25).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("calendar-attendees")
                Button { UIPasteboard.general.string = entry.item.event.attendees.map(\.email).joined(separator: ", ") } label: { MacroIcon(name: "copy", size: 17).frame(width: 38.25, height: 38.25) }.accessibilityLabel("Copy guest emails")
                if !others.isEmpty {
                    Button { Task { await emailGuests() } } label: { MacroIcon(name: "envelope", size: 17).frame(width: 38.25, height: 38.25) }.accessibilityLabel("Email guests")
                }
            }.buttonStyle(.plain).padding(.leading, 17).padding(.trailing, 8.5)
            if expandedGuests {
                VStack(spacing: 12.75) {
                    ForEach(entry.item.event.attendees.sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }) { guest in
                        HStack(spacing: 17) {
                            AvatarView(name: guest.label, size: 25.5, photoURL: photos["macro|" + guest.email])
                            VStack(alignment: .leading, spacing: 2.125) {
                                Text(guest.label + (guest.isSelf ? " (you)" : "")).lineLimit(1)
                                if guest.isOrganizer || guest.isOptional { Text([guest.isOrganizer ? "Organizer" : "", guest.isOptional ? "Optional" : ""].filter { !$0.isEmpty }.joined(separator: " · ")).font(.system(size: 12.75)).foregroundStyle(.tertiary) }
                            }
                            Spacer(minLength: 0)
                            if guest.responseStatus != "needs_action" {
                                MacroIcon(name: guest.responseStatus == "accepted" ? "check" : guest.responseStatus == "declined" ? "x" : "question-mark", size: 14.875)
                                    .foregroundStyle(guest.responseStatus == "accepted" ? .green : guest.responseStatus == "declined" ? .red : .orange)
                                    .accessibilityLabel(guest.responseStatus.capitalized)
                            }
                        }
                    }
                }.padding(.leading, 55.25).padding(.trailing, 21.25).padding(.top, 6.375).padding(.bottom, 12.75)
            }
        }
    }
    private var rsvp: some View {
        HStack(spacing: 12.75) {
            Text("Going?"); Spacer()
            responseButton("Yes", value: "accepted"); responseButton("Maybe", value: "tentative"); responseButton("No", value: "declined")
        }.padding(.horizontal, 25.5).padding(.top, 17).padding(.bottom, 8.5)
    }
    private func responseButton(_ title: String, value: String) -> some View {
        let selected = entry.item.event.attendees.first(where: \.isSelf)?.responseStatus == value
        return Button {
            if entry.isRecurring { response = value }
            else { Task { await store.respond(entry, response: value, scope: "all") } }
        } label: {
            Text(title).font(.system(size: 14.875, weight: .medium)).padding(.horizontal, 12.75).frame(height: 46.75)
                .background(selected ? MacroTheme.accent.opacity(0.08) : Color.primary.opacity(0.05), in: Capsule())
                .overlay(Capsule().strokeBorder(.primary.opacity(0.05), lineWidth: 1))
        }.buttonStyle(.plain).foregroundStyle(selected ? MacroTheme.accent : .primary).disabled(store.isSaving)
            .accessibilityIdentifier("calendar-rsvp-\(value)").accessibilityAddTraits(selected ? [.isSelected] : [])
    }
    private var declinedNotice: some View {
        HStack(alignment: .top, spacing: 17) {
            MacroIcon(name: "exclamation-mark", size: 21.25)
            VStack(alignment: .leading, spacing: 17) {
                Text("Everyone else declined this event").fontWeight(.medium).foregroundStyle(.primary)
                if store.canEdit(entry) {
                    HStack { Spacer(); Button("Delete") { confirmDelete = true }; Button("Reschedule") { editing = true }.fontWeight(.medium) }
                }
            }
        }.padding(12.75).background(.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8.5))
    }
    private var schedule: String { NativeCalendarDetailFormatting.schedule(entry, calendar: store.calendar, use24Hour: use24Hour) }
    private func sendResponse(scope: String) { guard let response else { return }; self.response = nil; Task { await store.respond(entry, response: response, scope: scope) } }
    private func delete(scope: String) { Task { if await store.delete(entry, scope: scope) { dismiss() } } }
    private func copyEvent() {
        let target = NativeCalendarDetailFormatting.link(entry, baseURL: session.environment.webURL, period: store.period)
        UIPasteboard.general.setItems([[UTType.html.identifier: Data(NativeCalendarDetailFormatting.mentionHTML(entry).utf8),
            UTType.utf8PlainText.identifier: target.absoluteString, UTType.url.identifier: target]])
        copied = true
    }
    private func emailGuests() async {
        await emailStore.loadInboxes()
        guard let inbox = emailStore.sendingInbox else { actionError = emailStore.error ?? "Connect an email account to email guests."; return }
        emailDraft = EmailComposition(inboxID: inbox.id, to: others.map(\.email).joined(separator: ", "))
    }
}

private struct NativeCalendarDescription: View {
    let html: String
    @State private var formatted: AttributedString?
    var body: some View {
        Text(formatted ?? AttributedString(NativeCalendarText.plain(html)))
            .task(id: html) {
                let projection = await Task.detached {
                    let text = EmailBodyFormatting.nativeText(html: html, plainText: html)
                    return (text, EmailBodyFormatting.spans(html: html, plainText: text))
                }.value
                guard !Task.isCancelled else { return }
                var result = AttributedString(projection.0)
                for span in projection.1 {
                    guard let range = Range(span.range, in: projection.0),
                          let lower = AttributedString.Index(range.lowerBound, within: result),
                          let upper = AttributedString.Index(range.upperBound, within: result) else { continue }
                    switch span.style {
                    case .bold: result[lower..<upper].inlinePresentationIntent = (result[lower..<upper].inlinePresentationIntent ?? []).union(.stronglyEmphasized)
                    case .italic: result[lower..<upper].inlinePresentationIntent = (result[lower..<upper].inlinePresentationIntent ?? []).union(.emphasized)
                    case .link(let url): result[lower..<upper].link = url
                    }
                }
                formatted = result
            }
    }
}
