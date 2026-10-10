import Foundation

struct NativeCalendarLoad {
    var items: [NativeCalendarItem]
    var isSyncing: Bool
}

@MainActor
protocol NativeCalendarService {
    func calendars() async throws -> [NativeCalendarSource]
    func occurrences(in range: NativeCalendarRange) async throws -> NativeCalendarLoad
    func create(_ body: NativeCalendarMutation) async throws -> NativeCalendarEvent
    func update(_ id: String, body: NativeCalendarMutation) async throws -> NativeCalendarEvent
    func delete(_ id: String, calendarID: String?, scope: String, recurrenceID: String?) async throws
    func respond(_ id: String, calendarID: String?, response: String, scope: String, recurrenceID: String?) async throws -> NativeCalendarEvent
}

/// Uses the same calendar/DSS contracts as the web client, through the user's native session.
@MainActor
final class NativeCalendarAPI: NativeCalendarService {
    typealias Transport = @MainActor (URLRequest) async throws -> Data
    private let baseURL: URL
    private let transport: Transport
    private let decoder = JSONDecoder()

    init(baseURL: URL, transport: @escaping Transport) { self.baseURL = baseURL; self.transport = transport }
    convenience init(session: NativeSession) {
        self.init(baseURL: session.environment.gatewayURL, transport: { try await session.authenticatedData(for: $0) })
    }

    func calendars() async throws -> [NativeCalendarSource] {
        struct Response: Decodable { var calendars: [NativeCalendarSource] }
        let result: Response = try await decoded(path: "calendar/calendars")
        return result.calendars
    }

    func occurrences(in range: NativeCalendarRange) async throws -> NativeCalendarLoad {
        var items: [String: NativeCalendarItem] = [:]
        var cursor: String?
        var seen: Set<String> = []
        var syncing = false
        repeat {
            try Task.checkCancellation()
            var query = [URLQueryItem(name: "start", value: MessageDate.string(range.start)),
                         URLQueryItem(name: "end", value: MessageDate.string(range.end)),
                         URLQueryItem(name: "startDate", value: range.startDate),
                         URLQueryItem(name: "endDate", value: range.endDate), URLQueryItem(name: "limit", value: "2000")]
            if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
            let page: NativeCalendarPage = try await decoded(path: "dss/calendar-events", query: query)
            syncing = syncing || page.syncStatus == "syncing"
            for item in page.items { items[item.id] = item }
            if !page.hasMore { break }
            guard let next = page.nextCursor, !next.isEmpty, seen.insert(next).inserted else {
                throw NativeCalendarError.invalidPagination
            }
            cursor = next
        } while cursor != nil
        return NativeCalendarLoad(items: Array(items.values), isSyncing: syncing)
    }

    func create(_ body: NativeCalendarMutation) async throws -> NativeCalendarEvent {
        try await decoded(path: "calendar/events", method: "POST", body: JSONEncoder().encode(body))
    }
    func update(_ id: String, body: NativeCalendarMutation) async throws -> NativeCalendarEvent {
        try await decoded(path: "calendar/events/\(id)", method: "PATCH", body: JSONEncoder().encode(body))
    }
    func delete(_ id: String, calendarID: String?, scope: String, recurrenceID: String?) async throws {
        var query = [URLQueryItem(name: "scope", value: scope)]
        if let calendarID { query.append(URLQueryItem(name: "calendarId", value: calendarID)) }
        if let recurrenceID { query.append(URLQueryItem(name: "recurrenceId", value: recurrenceID)) }
        _ = try await data(path: "calendar/events/\(id)", method: "DELETE", query: query)
    }
    func respond(_ id: String, calendarID: String?, response: String, scope: String, recurrenceID: String?) async throws -> NativeCalendarEvent {
        struct Body: Encodable { var calendarId: String?; var response: String; var scope: String; var recurrenceId: String? }
        let body = Body(calendarId: calendarID, response: response, scope: scope, recurrenceId: recurrenceID)
        return try await decoded(path: "calendar/events/\(id)/rsvp", method: "PUT", body: JSONEncoder().encode(body))
    }

    private func decoded<Response: Decodable>(path: String, method: String = "GET", query: [URLQueryItem] = [], body: Data? = nil) async throws -> Response {
        try decoder.decode(Response.self, from: await data(path: path, method: method, query: query, body: body))
    }
    private func data(path: String, method: String = "GET", query: [URLQueryItem] = [], body: Data? = nil) async throws -> Data {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw NativeCalendarError.invalidResponse }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = method; request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return try await transport(request)
    }
}

#if DEBUG
/// Isolated calendar fixtures for preview and UI tests; never forwards to a real service.
@MainActor
final class FixtureCalendarService: NativeCalendarService {
    private(set) var events: [NativeCalendarEvent] = []
    let sources = [
        NativeCalendarSource(id: "demo-work", name: "Work", emailAddress: "alex@macro.local", emailLinkId: "demo-inbox",
            isPrimary: true, isSubscription: false, isWritable: true, color: "#657B91"),
        NativeCalendarSource(id: "demo-personal", name: "Personal", emailAddress: "alex@macro.local", emailLinkId: "demo-inbox",
            isPrimary: false, isSubscription: false, isWritable: true, color: "#A88260")
    ]
    init(now: Date = Date()) {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: now)
        for (index, title) in ["Product check-in", "Design review", "A little time to think"].enumerated() {
            let start = calendar.date(byAdding: .hour, value: 10 + index * 2, to: today)!
            let time = NativeCalendarTime.timed(startsAt: MessageDate.string(start), endsAt: MessageDate.string(start.addingTimeInterval(1_800)), timeZone: TimeZone.current.identifier)
            events.append(NativeCalendarEvent(id: "demo-calendar-\(index)", calendarId: index == 2 ? "demo-personal" : "demo-work", title: title,
                description: index == 1 ? "Review the details of our native mobile experience." : nil,
                location: index == 1 ? "Studio" : nil, isReadOnly: false, time: time,
                attendees: [NativeCalendarAttendee(email: "alex@macro.local", displayName: "Alex Morgan", isSelf: true, responseStatus: "accepted"),
                            NativeCalendarAttendee(email: "jamie@macro.local", displayName: "Jamie Chen", responseStatus: "accepted")],
                recurrenceLines: [], status: "confirmed", organizerName: "Alex Morgan", organizerEmail: "alex@macro.local"))
        }
    }
    func calendars() async throws -> [NativeCalendarSource] { sources }
    func occurrences(in range: NativeCalendarRange) async throws -> NativeCalendarLoad {
        let items = events.compactMap { event -> NativeCalendarItem? in
            guard let interval = event.time.interval(), interval.start < range.end, interval.end > range.start else { return nil }
            return NativeCalendarItem(event: event, occurrence: NativeCalendarOccurrence(eventId: event.id,
                occurrenceKey: MessageDate.string(interval.start), isCancelled: false, time: event.time))
        }
        return NativeCalendarLoad(items: items, isSyncing: false)
    }
    func create(_ body: NativeCalendarMutation) async throws -> NativeCalendarEvent {
        guard let time = body.time else { throw NativeCalendarError.invalidDates }
        let event = NativeCalendarEvent(id: UUID().uuidString, calendarId: body.calendarId, title: body.title ?? "",
            description: body.description, location: body.location, isReadOnly: false, time: time,
            attendees: (body.attendees ?? []).map { NativeCalendarAttendee(email: $0.email, isOptional: $0.isOptional) },
            recurrenceLines: body.recurrenceLines ?? [], status: "confirmed", transparency: body.transparency,
            visibility: body.visibility, reminders: body.reminders)
        events.append(event); return event
    }
    func update(_ id: String, body: NativeCalendarMutation) async throws -> NativeCalendarEvent {
        guard let index = events.firstIndex(where: { $0.id == id }) else { throw NativeCalendarError.invalidResponse }
        if let value = body.title { events[index].title = value }
        if let value = body.description { events[index].description = value }
        if let value = body.location { events[index].location = value }
        if let value = body.time { events[index].time = value }
        if let value = body.attendees { events[index].attendees = value.map { NativeCalendarAttendee(email: $0.email, isOptional: $0.isOptional) } }
        if let value = body.reminders { events[index].reminders = value }
        if let value = body.visibility { events[index].visibility = value }
        if let value = body.transparency { events[index].transparency = value }
        return events[index]
    }
    func delete(_ id: String, calendarID: String?, scope: String, recurrenceID: String?) async throws { events.removeAll { $0.id == id } }
    func respond(_ id: String, calendarID: String?, response: String, scope: String, recurrenceID: String?) async throws -> NativeCalendarEvent {
        guard let index = events.firstIndex(where: { $0.id == id }) else { throw NativeCalendarError.invalidResponse }
        for guest in events[index].attendees.indices where events[index].attendees[guest].isSelf {
            events[index].attendees[guest].responseStatus = response
        }
        return events[index]
    }
}
#endif
