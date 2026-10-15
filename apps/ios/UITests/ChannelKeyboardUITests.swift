import XCTest

@MainActor
final class ChannelKeyboardUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testSmallFirstDragStaysWhereTheReaderPutIt() throws {
        let app = openChannel()
        let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 280, dy: 360))
        start.press(forDuration: 0.02, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 65)),
                    withVelocity: .slow, thenHoldForDuration: 0.4)
        let first = try metrics(app)
        XCTAssertGreaterThan(number(first, "bottomDistance"), 25, "The first small drag must move the channel immediately")
        XCTAssertLessThan(number(first, "bottomDistance"), 110, "Exercise the former near-bottom pinning zone")
        let settled = expectation(description: "Allow delayed channel updates to arrive")
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { settled.fulfill() }
        wait(for: [settled], timeout: 4)
        let later = try metrics(app)
        XCTAssertEqual(number(later, "offset"), number(first, "offset"), accuracy: 2,
                       "Delayed layout or loading changes cannot snap a reader back to the bottom")
        attach(app, "Small first drag remains at the reading position")
    }

    func testKeyboardTracksFingerThroughPartialDismissalAndPreservesDraft() throws {
        let app = openChannel()
        try exerciseKeyboard(app, input: app.textViews["message-input"])
    }

    func testInlineReplyKeyboardAlsoTracksTheFinger() throws {
        let app = openChannel()
        let message = app.descendants(matching: .any).matching(identifier: "message-fixture-45").firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 4))
        message.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.55))
            .press(forDuration: 0.05, thenDragTo: message.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.55)))
        let input = app.textViews["inline-thread-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 4))
        try exerciseKeyboard(app, input: input)
    }

    private func exerciseKeyboard(_ app: XCUIApplication, input: XCUIElement) throws {
        input.tap(); input.typeText("Unsent keyboard gesture draft")
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 4))
        let close = app.buttons["inline-thread-close"]
        let gestureY = close.exists ? close.frame.minY - 18 : input.frame.minY - 24
        let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 300, dy: gestureY))
        let end = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 300, dy: app.frame.height - 90))
        start.press(forDuration: 0.02, thenDragTo: end, withVelocity: XCUIGestureVelocity(rawValue: 160), thenHoldForDuration: 0.5)
        let result = try metrics(app)
        let debug = XCTAttachment(string: String(describing: result))
        debug.name = "Keyboard tracking values"; debug.lifetime = .keepAlways; add(debug)
        XCTAssertEqual(result["keyboardDismissMode"] as? String, "interactive")
        XCTAssertGreaterThan(number(result, "keyboardPartialDraggingSamples"), 8,
                             "The keyboard must occupy intermediate positions while the finger is down")
        XCTAssertGreaterThan(number(result, "keyboardDragPositions"), 5,
                             "An abrupt close cannot pass by showing a single transitional frame")
        XCTAssertTrue((input.value as? String ?? "").contains("Unsent keyboard gesture draft"))
        if input.identifier == "message-input" {
            XCTAssertLessThanOrEqual(number(result, "bottomDistance"), 2,
                                     "Returning the dock after dismissal must keep the latest message above the composer")
            XCTAssertLessThanOrEqual(number(result, "maximumKeyboardContentOverlap"), 3,
                                     "Dragging beside the composer must reveal content without pushing the latest message underneath it")
        }
        attach(app, "Draft survives interactive keyboard dismissal")
    }

    private func openChannel() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--test-channel-motion"]
        app.launch()
        let channel = app.buttons["channel-01900000-0000-7000-8000-000000000001"]
        XCTAssertTrue(channel.waitForExistence(timeout: 6)); channel.tap()
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 4))
        return app
    }
    private func metrics(_ app: XCUIApplication) throws -> [String: Any] {
        let report = app.staticTexts["channel-motion-report"]
        XCTAssertTrue(report.waitForExistence(timeout: 3))
        let value = try XCTUnwrap(report.value as? String)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any])
    }
    private func number(_ values: [String: Any], _ key: String) -> Double { (values[key] as? NSNumber)?.doubleValue ?? -1 }
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
