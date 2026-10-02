import XCTest

@MainActor
final class ChannelManagementUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    func testNewMessageIsNativePageAndBackPreservesDraft() {
        let app = launch()
        app.buttons["workspace-create"].tap()
        let input = app.textViews["new-message-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5)); XCTAssertEqual(app.navigationBars.count, 0)
        input.tap(); input.typeText("A draft that stays on my phone")
        app.buttons["new-message-back"].tap()
        XCTAssertTrue(app.buttons["workspace-create"].waitForExistence(timeout: 4)); app.buttons["workspace-create"].tap()
        XCTAssertTrue(input.waitForExistence(timeout: 4)); XCTAssertEqual(input.value as? String, "A draft that stays on my phone")
        XCTAssertFalse(app.buttons["new-message-send"].isEnabled, "No channel or message is created without a recipient")
        capture(app, "Native new message full-page draft")
    }
    func testPrivateChannelCreationInviteAndInlineMembersUseNativeGlass() {
        let app = launch()
        app.buttons["workspace-create"].tap()
        XCTAssertTrue(app.buttons["new-channel-open"].waitForExistence(timeout: 4)); app.buttons["new-channel-open"].tap()
        let name = app.textFields["new-channel-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 4)); name.tap(); name.typeText("Native planning room")
        XCTAssertFalse(app.buttons["Done"].exists); XCTAssertEqual(app.navigationBars.count, 0)
        capture(app, "Native private channel creation drawer")
        app.buttons["new-channel-create"].tap()
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 6))
        app.buttons["Add people"].tap()
        let recipients = app.textFields["channel-recipient-input"]
        XCTAssertTrue(recipients.waitForExistence(timeout: 4)); recipients.tap(); recipients.typeText("new.person@example.test\n")
        let invite = app.buttons["channel-invite-submit"]
        for _ in 0..<2 where !invite.isHittable { app.swipeUp() }
        XCTAssertTrue(invite.isEnabled); capture(app, "Native invite people glass drawer"); invite.tap()
        XCTAssertTrue(app.buttons["Channel details"].waitForExistence(timeout: 4)); app.buttons["Channel details"].tap()
        app.buttons["channel-menu-participants"].tap()
        XCTAssertTrue(app.staticTexts["new.person@example.test"].waitForExistence(timeout: 4))
        let heading = app.staticTexts["Participants"].firstMatch
        XCTAssertGreaterThan(heading.frame.minY, app.buttons["channel-back"].frame.maxY)
        XCTAssertEqual(app.buttons.matching(identifier: "channel-back").count, 1)
        capture(app, "Native channel participants inside existing header")
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }
    private func launch() -> XCUIApplication {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing"]; app.launch()
        XCTAssertTrue(app.buttons["workspace-create"].waitForExistence(timeout: 5)); return app
    }
    private func capture(_ app: XCUIApplication, _ name: String) { let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment) }
}
