import XCTest

@MainActor
final class WorkspaceUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    func testDockFiltersFilesSearchAndSettings() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--workspace-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["pill-signal"].waitForExistence(timeout: 5))
        attach(app, "Home Signal and native dock")
        app.buttons["pill-noise"].tap()
        attach(app, "Home Noise")
        app.buttons["workspace-filters"].tap()
        XCTAssertTrue(app.buttons["workspace-filter-unread"].waitForExistence(timeout: 3))
        app.buttons["workspace-filter-unread"].tap()
        attach(app, "Native filter sheet")
        app.buttons["Clear all filters"].tap()
        app.buttons["workspace-filters-close"].tap()
        app.buttons["dock-files"].tap()
        XCTAssertTrue(app.buttons["pill-recent"].waitForExistence(timeout: 3))
        attach(app, "Files Recent")
        app.buttons["pill-myFiles"].tap()
        app.buttons["pill-sharedFiles"].tap()
        app.buttons["pill-folders"].tap()
        attach(app, "Files Folders")
        app.buttons["workspace-create"].tap()
        XCTAssertTrue(app.buttons["document-back"].waitForExistence(timeout: 5))
        attach(app, "Blank document opens directly in full-page editor")
        app.buttons["document-back"].tap()
        XCTAssertTrue(app.buttons["dock-search"].waitForExistence(timeout: 3))
        app.buttons["dock-search"].tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 3))
        search.tap(); search.typeText("launch")
        XCTAssertTrue(app.staticTexts["Mobile launch plan"].waitForExistence(timeout: 5))
        attach(app, "Native workspace search")
        app.buttons["workspace-search-close"].tap()
        app.buttons["dock-more"].tap()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 3))
        attach(app, "More workspace views")
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["settings-heading"].waitForExistence(timeout: 3))
        attach(app, "Account and appearance")
    }
    func testDockPreservesConversationDraftAcrossTabs() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "--workspace-testing"]; app.launch()
        app.buttons["dock-channels"].tap()
        let channel = app.buttons["channel-01900000-0000-7000-8000-000000000001"]
        XCTAssertTrue(channel.waitForExistence(timeout: 4)); channel.tap()
        let input = app.textViews["message-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 4)); input.tap(); input.typeText("A draft across tabs")
        app.tables["message-timeline"].swipeDown()
        if !app.buttons["dock-files"].isHittable { app.tables["message-timeline"].swipeDown() }
        XCTAssertTrue(app.buttons["dock-files"].waitForExistence(timeout: 3))
        app.buttons["dock-files"].tap(); app.buttons["dock-channels"].tap()
        XCTAssertTrue(input.waitForExistence(timeout: 3)); XCTAssertEqual(input.value as? String, "A draft across tabs")
        attach(app, "Conversation state survives switching tabs")
    }
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
