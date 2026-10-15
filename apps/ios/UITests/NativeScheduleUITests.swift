import XCTest

@MainActor
final class NativeScheduleUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    func testNativeScheduleFormsValidateAndPreserveDraftWithoutSubmitting() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "--workspace-testing"]; app.launch()
        openCreateMenu(app)
        app.buttons["create-drawer-automation"].tap()
        let prompt = app.textViews["automation-prompt"]
        XCTAssertTrue(prompt.waitForExistence(timeout: 5)); XCTAssertFalse(app.buttons["schedule-submit"].isEnabled)
        prompt.tap(); prompt.typeText("Summarize the weekly planning notes")
        XCTAssertTrue(app.buttons["schedule-submit"].isEnabled)
        capture(app, "Native automation instructions and recurring schedule")
        app.buttons["Close automation"].tap()
        openCreateMenu(app); app.buttons["create-drawer-automation"].tap()
        XCTAssertTrue(prompt.waitForExistence(timeout: 4)); XCTAssertEqual(prompt.value as? String, "Summarize the weekly planning notes")
        app.buttons["Close automation"].tap()
        openCreateMenu(app)
        let reminder = app.buttons["create-drawer-reminder"]
        for _ in 0..<3 where !reminder.isHittable { app.swipeUp() }
        reminder.tap()
        XCTAssertTrue(app.textFields["reminder-description"].waitForExistence(timeout: 4))
        XCTAssertFalse(app.buttons["schedule-submit"].isEnabled)
        XCTAssertTrue(app.buttons["schedule-frequency-once"].exists)
        app.buttons["schedule-frequency-week"].tap()
        XCTAssertTrue(app.buttons["Mon"].exists)
        capture(app, "Native reminder and weekly day controls")
        app.buttons["Close reminder"].tap()
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }
    private func openCreateMenu(_ app: XCUIApplication) {
        XCTAssertTrue(app.buttons["workspace-create"].waitForExistence(timeout: 5)); app.buttons["workspace-create"].tap()
        let more = app.buttons["create-menu-more"]; XCTAssertTrue(more.waitForExistence(timeout: 4)); more.tap()
        XCTAssertTrue(app.buttons["create-drawer-automation"].waitForExistence(timeout: 5))
    }
    private func capture(_ app: XCUIApplication, _ name: String) { let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment) }
}
