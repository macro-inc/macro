import XCTest

@MainActor
final class ChannelAttachmentUITests: XCTestCase {
    func testSelectedFileSurvivesNavigationAndCanSendWithoutText() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing"]; app.launch()
        let channel = app.buttons["channel-01900000-0000-7000-8000-000000000001"]
        XCTAssertTrue(channel.waitForExistence(timeout: 5)); channel.tap()
        app.buttons["channel-attach"].tap()
        let file = app.buttons["channel-file-workspace-design"]
        XCTAssertTrue(file.waitForExistence(timeout: 4)); file.tap()
        XCTAssertTrue(app.buttons["Remove attachment Mobile launch plan"].waitForExistence(timeout: 3))
        app.buttons["channel-back"].tap(); channel.tap()
        XCTAssertTrue(app.buttons["Remove attachment Mobile launch plan"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["send-message"].isEnabled)
        let before = XCTAttachment(screenshot: app.screenshot()); before.name = "Native file selection and preserved attachment draft"; before.lifetime = .keepAlways; add(before)
        app.buttons["send-message"].tap()
        XCTAssertTrue(app.buttons["Open attachment"].waitForExistence(timeout: 4))
        XCTAssertFalse(app.buttons["Remove attachment Mobile launch plan"].exists)
        let sent = XCTAttachment(screenshot: app.screenshot()); sent.name = "Attachment-only native send"; sent.lifetime = .keepAlways; add(sent)
    }
}
