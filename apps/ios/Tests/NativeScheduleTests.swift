import XCTest
@testable import MacroNative

@MainActor
final class NativeScheduleTests: XCTestCase {
    func testAutomationMatchesProductionModelAndSixFieldSundayBasedCron() async throws {
        var draft = NativeScheduleDraft(); draft.prompt = "Summarize our channel"; draft.days = [1, 3, 7]; draft.hour = 14; draft.minute = 35; draft.timezone = "America/New_York"
        let api = NativeScheduleAPI(gateway: URL(string: "https://gateway.example.invalid")!) { request in
            XCTAssertEqual(request.url?.path, "/scheduled-action/scheduled-actions"); XCTAssertEqual(request.httpMethod, "POST")
            let body = try JSONDecoder().decode(WorkspaceJSON.self, from: XCTUnwrap(request.httpBody))
            XCTAssertEqual(body["trigger"]["type"].string, "cron"); XCTAssertEqual(body["trigger"]["schedule"].string, "0 35 14 * * 1,3,7")
            XCTAssertEqual(body["trigger"]["timezone"].string, "America/New_York")
            XCTAssertEqual(body["task"]["model"].string, "anthropic/claude-sonnet-5"); XCTAssertEqual(body["task"]["prompt"].string, "")
            XCTAssertEqual(body["task"]["user_prompt"].string, draft.prompt); XCTAssertEqual(body["name"].string, draft.prompt)
            XCTAssertEqual(body["kind"].string, "Agent"); XCTAssertEqual(body["enabled"].bool, true)
            return Data(#"{"id":"automation"}"#.utf8)
        }
        let id = try await api.create(.automation, draft: draft); XCTAssertEqual(id, "automation")
    }
    func testReminderOnceOmitsEntityAndRecurringUsesDifferentCronShape() throws {
        var draft = NativeScheduleDraft(); draft.prompt = "Follow up"; draft.frequency = .once
        draft.onceDate = Date(timeIntervalSince1970: 2_000_000_000)
        let body = try draft.requestBody(for: .reminder, now: Date(timeIntervalSince1970: 0))
        XCTAssertEqual(body["schedule"]["type"].string, "once"); XCTAssertEqual(body["description"].string, "Follow up")
        XCTAssertNil(body["entityId"].string); XCTAssertNil(body["entityType"].string)
        draft.frequency = .month; draft.monthDay = 15; draft.hour = 8; draft.minute = 5
        let recurring = try draft.requestBody(for: .reminder)
        XCTAssertEqual(recurring["schedule"]["type"].string, "recurring"); XCTAssertEqual(recurring["schedule"]["cron"].string, "0 5 8 15 * *")
        XCTAssertNil(recurring["schedule"]["schedule"].string)
    }
    func testInvalidSchedulesNeverSilentlyBecomeDailyOrChangeTime() throws {
        var draft = NativeScheduleDraft(); draft.prompt = "Reminder"; draft.days = []
        XCTAssertThrowsError(try draft.requestBody(for: .automation))
        draft.days = [0]; XCTAssertThrowsError(try draft.cron())
        draft.days = [2]; draft.hour = 24; XCTAssertThrowsError(try draft.cron())
        draft.frequency = .once; draft.onceDate = Date(timeIntervalSince1970: 0)
        XCTAssertThrowsError(try draft.requestBody(for: .reminder))
    }
}
