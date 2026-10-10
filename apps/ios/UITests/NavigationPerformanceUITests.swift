import XCTest

@MainActor
final class NavigationPerformanceUITests: XCTestCase {
    private let productChannelID = "01900000-0000-7000-8000-000000000001"
    private let directChannelID = "01900000-0000-7000-8000-000000000002"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testRepeatedChannelOpenAndBackKeepsTheComposerReady() {
        let app = launch()
        var openTimes: [Double] = []
        for iteration in 0..<5 {
            let start = ProcessInfo.processInfo.systemUptime
            channel(productChannelID, in: app).tap()
            let input = app.textViews["message-input"]
            XCTAssertTrue(input.waitForExistence(timeout: 3))
            XCTAssertTrue(app.tables["message-timeline"].waitForExistence(timeout: 3))
            openTimes.append((ProcessInfo.processInfo.systemUptime - start) * 1_000)
            XCTAssertTrue(input.isHittable, "Reopening \(iteration + 1) must present a usable native composer.")

            app.buttons["channel-back"].tap()
            XCTAssertTrue(channel(productChannelID, in: app).waitForExistence(timeout: 3))
            XCTAssertFalse(input.exists, "Back navigation must remove the previous conversation.")
        }
        let values = openTimes.map { String(format: "%.0f", $0) }.joined(separator: ", ")
        let attachment = XCTAttachment(string: "Tap-to-composer automation timings: [\(values)] ms. Includes XCTest action synchronization and navigation animation; model timing budgets are enforced in PerformanceTests.")
        attachment.name = "Repeated native channel navigation timings"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testNativeEdgeSwipeBackPreservesSeparateChannelDrafts() {
        let app = launch()
        open(productChannelID, in: app)
        let firstDraft = "Keep this product draft\nAfter a native swipe back"
        app.textViews["message-input"].tap()
        app.textViews["message-input"].typeText(firstDraft)

        edgeSwipeBack(in: app)
        XCTAssertTrue(channel(productChannelID, in: app).waitForExistence(timeout: 3), "The iPhone edge gesture must return to conversations.")
        open(directChannelID, in: app)
        waitForValue("", of: app.textViews["message-input"])
        let directDraft = "A separate direct message draft"
        app.textViews["message-input"].tap()
        app.textViews["message-input"].typeText(directDraft)
        edgeSwipeBack(in: app)

        XCTAssertTrue(channel(productChannelID, in: app).waitForExistence(timeout: 3))
        open(productChannelID, in: app)
        waitForValue(firstDraft, of: app.textViews["message-input"])
        XCTAssertTrue(app.buttons["send-message"].isEnabled)
        edgeSwipeBack(in: app)
        XCTAssertTrue(channel(directChannelID, in: app).waitForExistence(timeout: 3))
        open(directChannelID, in: app)
        waitForValue(directDraft, of: app.textViews["message-input"])
        XCTAssertTrue(app.buttons["send-message"].isEnabled)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Independent drafts survive native edge-swipe navigation"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(channel(productChannelID, in: app).waitForExistence(timeout: 10))
        return app
    }

    private func channel(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons["channel-\(id)"]
    }

    private func open(_ id: String, in app: XCUIApplication) {
        channel(id, in: app).tap()
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 3))
    }

    private func edgeSwipeBack(in app: XCUIApplication) {
        let screen = app.windows.firstMatch
        let start = screen.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.42))
        let finish = screen.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.42))
        start.press(forDuration: 0.05, thenDragTo: finish)
    }

    private func waitForValue(_ value: String, of element: XCUIElement) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 3), .completed)
    }
}
