import XCTest

@MainActor final class NativeSettingsUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    func testSettingsUsesFloatingDrawerAndKeepsNativeAppearance() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "--workspace-testing"]; app.launch()
        XCTAssertTrue(app.buttons["dock-more"].waitForExistence(timeout: 5)); app.buttons["dock-more"].tap()
        let settings = app.buttons["Settings"]; XCTAssertTrue(settings.waitForExistence(timeout: 4)); settings.tap()
        let heading = app.staticTexts["settings-heading"]
        XCTAssertTrue(heading.waitForExistence(timeout: 5)); XCTAssertEqual(app.navigationBars.count, 0)
        let close = app.buttons["settings-close"]
        XCTAssertTrue(close.isHittable); XCTAssertEqual(close.frame.width, 46.75, accuracy: 1)
        let appearance = app.buttons["settings-appearance"]
        XCTAssertTrue(appearance.exists); XCTAssertEqual(appearance.frame.height, 55.25, accuracy: 1)
        let capture = XCTAttachment(screenshot: app.screenshot()); capture.name = "Settings production floating drawer"; capture.lifetime = .keepAlways; add(capture)
        appearance.tap()
        XCTAssertTrue(app.buttons["appearance-dark"].waitForExistence(timeout: 3)); app.buttons["appearance-dark"].tap()
        XCTAssertTrue(app.buttons["appearance-dark"].isSelected)
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(close.waitForExistence(timeout: 3)); close.tap()
        XCTAssertTrue(app.buttons["dock-more"].waitForExistence(timeout: 3))
    }
    func testExplicitNewAgentRetainsACPConversationRoute() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "--workspace-testing"]; app.launch()
        XCTAssertTrue(app.buttons["workspace-create"].waitForExistence(timeout: 5)); app.buttons["workspace-create"].tap()
        let more = app.buttons["create-menu-more"]; XCTAssertTrue(more.waitForExistence(timeout: 3)); more.tap()
        let create = app.buttons["create-drawer-agent"]; XCTAssertTrue(create.waitForExistence(timeout: 4)); create.tap()
        let input = app.textViews["agent-create-input"]; XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertFalse(app.scrollViews["cognition-timeline"].exists)
        input.tap(); input.typeText("Review our native implementation")
        app.buttons["agent-create-send"].tap()
        XCTAssertTrue(app.scrollViews["agent-timeline"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.scrollViews["cognition-timeline"].exists)
        let capture = XCTAttachment(screenshot: app.screenshot()); capture.name = "Explicit New Agent keeps native ACP workflow"; capture.lifetime = .keepAlways; add(capture)
    }
}
