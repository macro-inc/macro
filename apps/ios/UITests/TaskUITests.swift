import XCTest

@MainActor
final class TaskUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testTaskCompletionStatusAndRenameAreNative() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--workspace-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["dock-more"].waitForExistence(timeout: 5))
        app.buttons["dock-more"].tap()
        app.buttons["Tasks"].tap()
        let tasks = app.buttons.matching(identifier: "workspace-item-workspace-task")
        XCTAssertTrue(tasks.firstMatch.waitForExistence(timeout: 5))
        guard let task = tasks.allElementsBoundByIndex.first(where: \.isHittable) else { XCTFail("Active task row is not reachable"); return }
        task.tap()
        let complete = app.buttons["task-completion"]
        XCTAssertTrue(complete.waitForExistence(timeout: 5))
        complete.tap()
        waitFor(NSPredicate(format: "value == %@", "Completed"), element: complete)
        app.buttons["task-status"].tap()
        app.buttons["In review"].tap()
        waitFor(NSPredicate(format: "value == %@", "Incomplete"), element: complete)
        app.buttons["task-rename"].tap()
        let title = app.alerts.textFields.firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 3))
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        title.typeText(" on iPhone")
        app.alerts.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Review the iPhone experience on iPhone"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["task-notes"].exists)
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "Native task status and properties"; image.lifetime = .keepAlways; add(image)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["Review the iPhone experience on iPhone"].waitForExistence(timeout: 5))
    }

    private func waitFor(_ predicate: NSPredicate, element: XCUIElement) {
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 5), .completed)
    }
}
