import XCTest

@MainActor
final class SettingsUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testMobileSettingsProfileAndAppearance() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--workspace-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["dock-more"].waitForExistence(timeout: 5))
        app.buttons["dock-more"].tap()
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.buttons["settings-profile"].waitForExistence(timeout: 5))
        screenshot(app, "Native mobile settings")
        app.buttons["settings-appearance"].tap()
        app.buttons["appearance-dark"].tap()
        screenshot(app, "Native dark appearance")
        app.buttons["appearance-system"].tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["settings-profile"].tap()
        let first = app.textFields["profile-first-name"]
        XCTAssertTrue(first.waitForExistence(timeout: 3))
        first.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap(); first.typeText(" Native")
        app.buttons["profile-save"].tap()
        XCTAssertTrue(app.buttons["Saved"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["Alex Native Morgan"].waitForExistence(timeout: 5))
        app.buttons["settings-close"].tap()
        XCTAssertTrue(app.buttons["dock-more"].waitForExistence(timeout: 3))
    }
    private func screenshot(_ app: XCUIApplication, _ title: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = title; attachment.lifetime = .keepAlways; add(attachment)
    }
}
