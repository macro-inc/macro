import XCTest

@MainActor
final class ChannelMotionUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testRowsRemainCoherentDuringTouchTrackingFlingAndAsyncResize() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--test-thread-scrolling", "--test-scrolling-resize", "--test-channel-motion"]
        app.launch()
        let channel = app.buttons["channel-01900000-0000-7000-8000-000000000001"]
        XCTAssertTrue(channel.waitForExistence(timeout: 8)); channel.tap()
        let table = app.tables["message-timeline"]
        XCTAssertTrue(table.waitForExistence(timeout: 5))
        let report = app.staticTexts["channel-motion-report"]
        XCTAssertTrue(report.waitForExistence(timeout: 5), "The fixture must sample geometry while the finger is moving")

        // These gestures execute while the in-app display link samples the live
        // presentation tree; no accessibility query can provide those frames.
        for _ in 0..<4 {
            drag(app, towardOlder: true, velocity: .slow)
            drag(app, towardOlder: false, velocity: .fast)
        }
        drag(app, towardOlder: true, velocity: .slow)
        let before = try summary(report)
        XCTAssertGreaterThan(number(before, "bottomDistance"), 150)
        let rows = before["visibleRows"] as? [[String: Any]] ?? []
        let anchor = try XCTUnwrap(rows.first { number($0, "y") > 140 && number($0, "y") + number($0, "height") < Double(app.frame.height - 170) })
        let anchorID = try XCTUnwrap(anchor["id"] as? String)
        let initialY = number(anchor, "y")
        let delay = expectation(description: "The fixture receives an older edited message")
        DispatchQueue.main.asyncAfter(deadline: .now() + 13) { delay.fulfill() }
        wait(for: [delay], timeout: 15)
        let afterResize = try summary(report)["visibleRows"] as? [[String: Any]] ?? []
        let anchored = try XCTUnwrap(afterResize.first { $0["id"] as? String == anchorID })
        XCTAssertEqual(number(anchored, "y"), initialY, accuracy: 2, "A remote resize cannot pull the reader to the bottom")
        for _ in 0..<3 {
            app.swipeDown(velocity: .fast)
            drag(app, towardOlder: false, velocity: .slow)
        }

        let metrics = try summary(report)
        let attachment = XCTAttachment(string: String(describing: metrics))
        attachment.name = "Frame-sampled channel motion metrics"; attachment.lifetime = .keepAlways; add(attachment)
        XCTAssertGreaterThan(number(metrics, "movingSamples"), 80, "Exercise actual motion, not just settled snapshots")
        XCTAssertGreaterThan(number(metrics, "draggingSamples"), 20)
        XCTAssertGreaterThan(number(metrics, "deceleratingSamples"), 20)
        XCTAssertEqual(number(metrics, "overlapSamples"), 0, "Rendered cells must never overlap, including transient frames")
        XCTAssertEqual(number(metrics, "geometryAnimationSamples"), 0, "Recycled hosted avatars and text cannot inherit position/bounds animations")
        XCTAssertEqual(number(metrics, "contentOverflowSamples"), 0, "A recycled content view cannot retain the previous row's height")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Channel after continuous motion"; screenshot.lifetime = .keepAlways; add(screenshot)
    }

    private func summary(_ element: XCUIElement) throws -> [String: Any] {
        let value = try XCTUnwrap(element.value as? String)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any])
    }
    private func number(_ values: [String: Any], _ key: String) -> Double { (values[key] as? NSNumber)?.doubleValue ?? -1 }
    private func drag(_ app: XCUIApplication, towardOlder: Bool, velocity: XCUIGestureVelocity) {
        // Avoid the floating header and composer: the table itself extends under both.
        let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.72, dy: 0.32))
        let bottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.72, dy: 0.70))
        (towardOlder ? top : bottom).press(forDuration: 0.02, thenDragTo: towardOlder ? bottom : top,
            withVelocity: velocity, thenHoldForDuration: 0)
    }
}
