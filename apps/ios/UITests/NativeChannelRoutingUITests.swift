import XCTest

@MainActor
final class NativeChannelRoutingUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testHomeAndSearchOpenUncachedChannelWithOneNativeHeader() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--workspace-testing"]
        app.launch()
        let row = app.buttons["workspace-item-workspace-channel"]
        XCTAssertTrue(row.waitForExistence(timeout: 6)); row.tap()
        assertNativeChannel(app)
        attach(app, "Home opens channel outside recent chat page")
        app.buttons["channel-back"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 4))
        app.buttons["dock-search"].tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 4)); search.tap(); search.typeText("Research room")
        let result = app.staticTexts["Research room"].firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 4)); result.tap()
        assertNativeChannel(app)
        attach(app, "Search opens native channel without duplicate navigation bar")
    }

    private func assertNativeChannel(_ app: XCUIApplication) {
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Channel details"].exists)
        let back = app.buttons["channel-back"]
        XCTAssertEqual(app.buttons.matching(identifier: "channel-back").count, 1)
        XCTAssertEqual(app.navigationBars.count, 0, "The parent destination must not add another native navigation bar.")
        XCTAssertLessThan(back.frame.minY, 90, "The floating back control must stay directly below the status bar.")
        XCTAssertLessThanOrEqual(back.frame.height, 44)
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
