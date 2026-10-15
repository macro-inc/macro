import XCTest

@MainActor
final class NativeTaskComposerUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testTaskDrawerPropertiesCreateMoreAndSubmissionAreNative() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "--workspace-testing"]; app.launch()
        app.buttons["dock-more"].tap(); app.buttons["Tasks"].tap()
        XCTAssertTrue(app.buttons["workspace-create"].waitForExistence(timeout: 5)); app.buttons["workspace-create"].tap()
        let name = app.descendants(matching: .any).matching(identifier: "create-name").firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 5)); name.tap(); name.typeText("Task from the native drawer")
        XCTAssertTrue(app.buttons["task-create-submit"].exists)
        XCTAssertEqual(app.navigationBars.count, 0, "The task drawer must not acquire a second Apple navigation header")
        XCTAssertTrue(app.buttons["task-status"].isHittable, "Properties remain visible above the keyboard")
        screenshot(app, "Task composer with native keyboard")
        app.buttons["task-status"].tap(); app.buttons["In Progress"].tap()
        app.buttons["task-priority"].tap(); app.buttons["High"].tap()
        app.buttons["task-due-date"].tap(); app.buttons["Tomorrow"].tap()
        app.buttons["task-tags"].tap(); app.buttons["Design"].tap(); app.buttons["Back to task"].tap()
        screenshot(app, "Task composer production property chips")
        let submit = app.buttons["task-create-submit"]
        XCTAssertTrue(submit.isHittable); XCTAssertLessThan(submit.frame.maxY, app.frame.maxY)
        app.buttons["task-create-more"].tap(); submit.tap()
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        XCTAssertEqual(name.value as? String, "")
        name.tap(); name.typeText("Another native task")
        app.buttons["task-create-more"].tap(); submit.tap()
        XCTAssertTrue(app.buttons["workspace-create"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Another native task"].exists)
        XCTAssertTrue(app.staticTexts["Task from the native drawer"].exists)
    }

    func testExpandCreatesDraftAndOpensNativeTaskDetails() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "--workspace-testing"]; app.launch()
        app.buttons["dock-more"].tap(); app.buttons["Tasks"].tap()
        app.buttons["workspace-create"].tap()
        let name = app.textFields["create-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 4)); name.tap(); name.typeText("Continue this native task")
        app.buttons["task-continue-editing"].tap()
        XCTAssertTrue(app.buttons["task-completion"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Continue this native task"].exists)
        XCTAssertFalse(app.webViews.firstMatch.exists)
        screenshot(app, "Task expanded into native details")
        app.buttons["Back to tasks"].tap()
        XCTAssertTrue(app.buttons["workspace-create"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Continue this native task"].exists)
    }

    private func screenshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
