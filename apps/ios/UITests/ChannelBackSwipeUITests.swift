import XCTest

@MainActor
final class ChannelBackSwipeUITests: XCTestCase {
    private let channelID = "channel-01900000-0000-7000-8000-000000000001"
    override func setUpWithError() throws { continueAfterFailure = false }

    func testRightSwipeStartingNearFarEdgeReturnsToListAndKeepsDraft() {
        let app = openChannel()
        let input = app.textViews["message-input"]
        input.tap(); input.typeText("Unsent back gesture draft")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 4))
        let y = min(350, max(170, input.frame.minY - 50))
        drag(app, from: CGPoint(x: app.frame.width * 0.78, y: y),
             to: CGPoint(x: app.frame.width * 0.98, y: y), velocity: 800)
        let channel = app.buttons[channelID]
        XCTAssertTrue(channel.waitForExistence(timeout: 5), "Back must work from the far side of the timeline, outside the system edge zone")
        XCTAssertFalse(app.buttons["channel-back"].exists)
        capture(app, "Far-right-start interactive back returns to channel list")
        channel.tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, "Unsent back gesture draft", "Navigating back never submits or drops a draft")
    }

    func testShortSlowRightSwipeCancelsWithoutMovingRowsOrLosingReadingPosition() throws {
        let app = openChannel()
        let input = app.textViews["message-input"]
        input.tap(); input.typeText("Keep the draft and reading position")
        let startY = input.frame.minY - 24
        drag(app, from: CGPoint(x: 300, y: startY),
             to: CGPoint(x: 300, y: app.frame.height - 90), velocity: 160, hold: 0.4)
        let beforeScroll = try offset(app)
        drag(app, from: CGPoint(x: app.frame.width * 0.6, y: 280),
             to: CGPoint(x: app.frame.width * 0.6, y: 465), velocity: 160, hold: 0.2)
        let beforeBack = try offset(app)
        XCTAssertGreaterThan(abs(beforeBack - beforeScroll), 30, "A vertical drag must still scroll the timeline")
        let tableX = app.tables["message-timeline"].frame.minX
        drag(app, from: CGPoint(x: app.frame.width * 0.55, y: 350),
             to: CGPoint(x: app.frame.width * 0.64, y: 350), velocity: 80, hold: 0.3)
        XCTAssertTrue(app.buttons["channel-back"].exists, "Releasing a short, slow right drag cancels the interactive transition")
        XCTAssertTrue(input.exists)
        XCTAssertEqual(input.value as? String, "Keep the draft and reading position")
        XCTAssertEqual(try offset(app), beforeBack, accuracy: 2, "Cancelling horizontal navigation must retain the vertical reading position")
        XCTAssertEqual(app.tables["message-timeline"].frame.minX, tableX, accuracy: 1)
        XCTAssertFalse(app.textViews["inline-thread-input"].exists, "Rightward movement must not trigger reply")
        XCTAssertFalse(app.buttons["workspace-create"].exists, "Cancelled navigation must keep the root action row hidden behind the channel")
        capture(app, "Cancelled back swipe preserves the channel and its draft")
    }

    func testLeftSwipeStillRepliesAndCancelledBackKeepsInlineDraft() {
        let app = openChannel()
        let message = app.descendants(matching: .any).matching(identifier: "message-fixture-45").firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 4))
        message.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.55))
            .press(forDuration: 0.05, thenDragTo: message.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.55)))
        let reply = app.textViews["inline-thread-input"]
        XCTAssertTrue(reply.waitForExistence(timeout: 5), "Left-swipe reply and right-swipe navigation must coexist")
        reply.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 4))
        reply.typeText("Keep this unsent inline reply")
        XCTAssertEqual(reply.value as? String, "Keep this unsent inline reply", "The draft must be settled before the navigation gesture")
        let y = min(350, max(170, reply.frame.minY - 55))
        drag(app, from: CGPoint(x: app.frame.width * 0.55, y: y),
             to: CGPoint(x: app.frame.width * 0.64, y: y), velocity: 80, hold: 0.3)
        XCTAssertTrue(app.buttons["channel-back"].exists)
        XCTAssertTrue(reply.exists)
        XCTAssertEqual(reply.value as? String, "Keep this unsent inline reply")
        XCTAssertFalse(app.navigationBars["Thread"].exists)
        XCTAssertFalse(app.buttons["workspace-create"].exists, "Cancelled navigation must not reveal the root Ask AI and New row")
        capture(app, "Left-swipe reply survives a cancelled back gesture")
    }

    private func openChannel() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--workspace-testing", "--test-channel-motion"]
        app.launch()
        let channels = app.buttons["dock-channels"]
        XCTAssertTrue(channels.waitForExistence(timeout: 6)); channels.tap()
        let channel = app.buttons[channelID]
        XCTAssertTrue(channel.waitForExistence(timeout: 6)); channel.tap()
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 5))
        return app
    }
    private func drag(_ app: XCUIApplication, from: CGPoint, to: CGPoint, velocity: CGFloat, hold: TimeInterval = 0) {
        let origin = app.coordinate(withNormalizedOffset: .zero)
        origin.withOffset(CGVector(dx: from.x, dy: from.y)).press(forDuration: 0.02,
            thenDragTo: origin.withOffset(CGVector(dx: to.x, dy: to.y)),
            withVelocity: XCUIGestureVelocity(rawValue: velocity), thenHoldForDuration: hold)
    }
    private func offset(_ app: XCUIApplication) throws -> Double {
        let report = app.staticTexts["channel-motion-report"]
        XCTAssertTrue(report.waitForExistence(timeout: 3))
        let value = try XCTUnwrap(report.value as? String)
        let data = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any])
        return try XCTUnwrap((data["offset"] as? NSNumber)?.doubleValue)
    }
    private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
    }
}
