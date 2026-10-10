import XCTest

@MainActor
final class ListSelectionUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testUnifiedRowsReachBothEdgesAndClearSelectionWhenReturning() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--workspace-testing"]
        app.launch()
        openAndReturn(app, row: "workspace-item-workspace-channel", back: "channel-back", name: "Notifications full-width rows")
        app.buttons["dock-email"].tap()
        openAndReturn(app, row: "email-thread-demo-email-design", back: "email-back", name: "Email full-width rows")
        app.buttons["dock-files"].tap()
        openAndReturn(app, row: "workspace-item-workspace-design", back: "document-back", name: "Files full-width rows")
        app.buttons["dock-channels"].tap()
        openAndReturn(app, row: "channel-01900000-0000-7000-8000-000000000001", back: "channel-back", name: "Channels full-width rows")
    }

    func testSearchAllRowsUseTheSameFullWidthSelectionAndResetOnReopen() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--workspace-testing"]
        app.launch()
        let search = app.buttons["dock-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 6)); search.tap()
        let input = app.searchFields["workspace-search-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 4)); input.typeText("Research")
        let row = app.buttons["search-result-workspace-channel"]
        XCTAssertTrue(row.waitForExistence(timeout: 6))
        XCTAssertEqual(row.frame.minX, app.frame.minX, accuracy: 1)
        XCTAssertEqual(row.frame.maxX, app.frame.maxX, accuracy: 1)
        XCTAssertFalse(row.isSelected)
        XCTAssertEqual(row.activityIndicators.count, 0)
        row.tap()
        let back = app.buttons["channel-back"]
        XCTAssertTrue(back.waitForExistence(timeout: 6)); back.tap()
        XCTAssertTrue(search.waitForExistence(timeout: 4)); search.tap()
        XCTAssertTrue(input.waitForExistence(timeout: 4)); input.typeText("Research")
        XCTAssertTrue(row.waitForExistence(timeout: 6)); XCTAssertFalse(row.isSelected)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Search All uses full-width selectable rows"; capture.lifetime = .keepAlways; add(capture)
    }

    private func openAndReturn(_ app: XCUIApplication, row id: String, back backID: String, name: String) {
        let row = app.buttons[id]
        XCTAssertTrue(row.waitForExistence(timeout: 6))
        XCTAssertEqual(row.frame.minX, app.frame.minX, accuracy: 1, "The selection surface must include the leading gutter")
        XCTAssertEqual(row.frame.maxX, app.frame.maxX, accuracy: 1, "The selection surface must include the trailing gutter")
        XCTAssertFalse(row.isSelected)
        XCTAssertEqual(row.activityIndicators.count, 0)
        row.tap()
        let back = app.buttons[backID]
        XCTAssertTrue(back.waitForExistence(timeout: 6)); back.tap()
        XCTAssertTrue(row.waitForExistence(timeout: 4))
        XCTAssertFalse(row.isSelected, "Returning to the list clears the retained opening highlight")
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = name; capture.lifetime = .keepAlways; add(capture)
    }
}
