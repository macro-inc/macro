import Foundation

enum NativeScheduleKind: String, Identifiable { case automation, reminder; var id: String { rawValue } }
enum NativeScheduleFrequency: String, Codable, CaseIterable { case once, week, month }

struct NativeScheduleDraft: Codable, Equatable {
    var name = ""
    var prompt = ""
    var frequency: NativeScheduleFrequency = .week
    var hour = 9
    var minute = 0
    var days: Set<Int> = [2, 3, 4, 5, 6]
    var monthDay = 1
    var timezone = TimeZone.current.identifier
    var onceDate = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Calendar.current.date(byAdding: .day, value: 1, to: Date())!)!

    func cron() throws -> String {
        guard (0...23).contains(hour), (0...59).contains(minute), TimeZone(identifier: timezone) != nil else { throw WorkspaceError.server("Choose a valid time and timezone.") }
        if frequency == .week {
            guard !days.isEmpty, days.allSatisfy({ (1...7).contains($0) }) else { throw WorkspaceError.server("Select at least one day.") }
            return "0 \(minute) \(hour) * * " + days.sorted().map(String.init).joined(separator: ",")
        }
        guard frequency == .month, (1...31).contains(monthDay) else { throw WorkspaceError.server("Pick a day between 1 and 31.") }
        return "0 \(minute) \(hour) \(monthDay) * *"
    }

    func requestBody(for kind: NativeScheduleKind, now: Date = Date()) throws -> WorkspaceJSON {
        let instructions = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !instructions.isEmpty else { throw WorkspaceError.server(kind == .automation ? "Prompt is required." : "Enter a reminder description.") }
        if kind == .automation {
            let normalized = instructions.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
            let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
            return .object(["name": .string(title.isEmpty ? normalized.count > 72 ? String(normalized.prefix(71)) + "…" : normalized : title),
                "trigger": .object(["type": .string("cron"), "schedule": .string(try cron()), "timezone": .string(timezone)]),
                "kind": .string("Agent"), "task": .object(["model": .string("anthropic/claude-sonnet-5"), "prompt": .string(""), "user_prompt": .string(instructions)]), "enabled": .bool(true)])
        }
        let schedule: WorkspaceJSON
        if frequency == .once {
            guard onceDate > now else { throw WorkspaceError.server("Choose a future date and time.") }
            schedule = .object(["type": .string("once"), "remindAt": .string(MessageDate.string(onceDate))])
        } else {
            schedule = .object(["type": .string("recurring"), "cron": .string(try cron()), "timezone": .string(timezone)])
        }
        return .object(["description": .string(String(String.UnicodeScalarView(instructions.unicodeScalars.prefix(2000)))), "schedule": schedule])
    }
}

@MainActor
final class NativeScheduleAPI {
    typealias Request = @MainActor (URLRequest) async throws -> Data
    private let gateway: URL
    private let demo: Bool
    private let request: Request
    convenience init(session: NativeSession) {
        self.init(gateway: session.environment.gatewayURL, demo: session.isDemo) { try await session.authenticatedData(for: $0) }
    }
    init(gateway: URL, demo: Bool = false, request: @escaping Request) { self.gateway = gateway; self.demo = demo; self.request = request }
    func create(_ kind: NativeScheduleKind, draft: NativeScheduleDraft) async throws -> String {
        let body = try draft.requestBody(for: kind)
        if demo { return "demo-" + kind.rawValue }
        var input = URLRequest(url: gateway.appendingPathComponent(kind == .automation ? "scheduled-action/scheduled-actions" : "dss/reminders"))
        input.httpMethod = "POST"; input.setValue("application/json", forHTTPHeaderField: "Content-Type")
        input.httpBody = try JSONEncoder().encode(body)
        let data = try await request(input)
        let result = try JSONDecoder().decode(WorkspaceJSON.self, from: data)
        guard let id = result["id"].string, !id.isEmpty else { throw WorkspaceError.invalidResponse }
        return id
    }
}
