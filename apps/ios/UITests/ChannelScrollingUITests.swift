import XCTest

@MainActor
final class ChannelScrollingUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testShortConversationEndsImmediatelyAboveTheComposer() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "--test-short-channel"]; app.launch()
        let channel = app.buttons["channel-01900000-0000-7000-8000-000000000001"]
        XCTAssertTrue(channel.waitForExistence(timeout: 8)); channel.tap()
        let input = app.textViews["message-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        let last = app.descendants(matching: .any)["message-fixture-45"].firstMatch
        XCTAssertTrue(last.waitForExistence(timeout: 5))
        XCTAssertLessThan(input.frame.minY - last.frame.maxY, 70)
        XCTAssertGreaterThan(last.frame.minY, app.frame.height / 2)
        capture(app, "Short conversation rests at the bottom")
    }

    func testLongThreadsNeverOverlapWhileRecyclingRows() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--test-thread-scrolling"]
        app.launch()
        let channel = app.buttons["channel-01900000-0000-7000-8000-000000000001"]
        XCTAssertTrue(channel.waitForExistence(timeout: 8)); channel.tap()
        let table = app.tables["message-timeline"]
        XCTAssertTrue(table.waitForExistence(timeout: 5))
        for index in 0..<4 {
            assertSeparatedMessages(in: app)
            table.swipeDown(velocity: .slow)
            if index == 3 { capture(app, "Long thread rows while scrolling upward") }
        }
        for _ in 0..<4 { table.swipeUp(velocity: .fast); assertSeparatedMessages(in: app) }
        capture(app, "Long thread rows after repeated recycling")
        let expand = app.buttons["expand-thread-fixture-45"]
        if !expand.isHittable { table.swipeUp() }
        XCTAssertTrue(expand.waitForExistence(timeout: 5)); expand.tap()
        for _ in 0..<3 { table.swipeDown(velocity: .slow); assertSeparatedMessages(in: app) }
        capture(app, "Expanded long thread has separate measured rows")
    }

    func testResizingAnOlderMessageKeepsTheReadingPosition() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--test-thread-scrolling", "--test-scrolling-resize", "--test-channel-motion"]
        app.launch()
        let channel = app.buttons["channel-01900000-0000-7000-8000-000000000001"]
        XCTAssertTrue(channel.waitForExistence(timeout: 8)); channel.tap()
        let table = app.tables["message-timeline"]
        XCTAssertTrue(table.waitForExistence(timeout: 5))
        let report = app.staticTexts["channel-motion-report"]
        XCTAssertTrue(report.waitForExistence(timeout: 4))
        // The table includes the floating header/composer. Start inside its
        // readable viewport so XCTest actually scrolls instead of hitting chrome.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.72, dy: 0.32))
            .press(forDuration: 0.02, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.72, dy: 0.70)), withVelocity: .slow, thenHoldForDuration: 0)
        let before = try XCTUnwrap(report.value as? String)
        let beforeJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(before.utf8)) as? [String: Any])
        XCTAssertGreaterThan(try XCTUnwrap(beforeJSON["draggingSamples"] as? Double), 20, "The gesture must actually move the channel timeline")
        XCTAssertGreaterThan(try XCTUnwrap(beforeJSON["bottomDistance"] as? Double), 150, "Establish a reading position away from the bottom")
        // Use sampled presentation geometry rather than a SwiftUI accessibility
        // node that UITableView can retain with stale coordinates after reuse.
        let beforeRows = beforeJSON["visibleRows"] as? [[String: Any]] ?? []
        let originalRow = try XCTUnwrap(beforeRows.first {
            let y = $0["y"] as? Double ?? 0, height = $0["height"] as? Double ?? 0
            return ($0["id"] as? String)?.contains("stress-") == true && y > 110 && y + height < Double(app.frame.height - 180)
        }, "A long reply must be fully visible for the resize check")
        let rowID = try XCTUnwrap(originalRow["id"] as? String)
        let beforeAttachment = XCTAttachment(string: before); beforeAttachment.name = "Before older-message resize"; beforeAttachment.lifetime = .keepAlways; add(beforeAttachment)
        capture(app, "Reading anchor before older content grows")
        let elapsed = expectation(description: "The delayed older-message update arrives")
        DispatchQueue.main.asyncAfter(deadline: .now() + 13) { elapsed.fulfill() }
        wait(for: [elapsed], timeout: 15)
        let after = try XCTUnwrap(report.value as? String)
        let afterAttachment = XCTAttachment(string: after); afterAttachment.name = "After older-message resize"; afterAttachment.lifetime = .keepAlways; add(afterAttachment)
        print("RESIZE PROBE BEFORE \(before) AFTER \(after)")
        let afterJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(after.utf8)) as? [String: Any])
        let afterRows = afterJSON["visibleRows"] as? [[String: Any]] ?? []
        let resizedRow = try XCTUnwrap(afterRows.first { $0["id"] as? String == rowID }, "The frame-sampled reading row must remain visible")
        XCTAssertEqual(try XCTUnwrap(resizedRow["y"] as? Double), try XCTUnwrap(originalRow["y"] as? Double), accuracy: 2, "The real UITableView row must retain its reading position")
        capture(app, "Reading position remains stable while older content grows")
    }

    private func assertSeparatedMessages(in app: XCUIApplication) {
        let table = app.tables["message-timeline"]
        let rowIDs = Set(table.cells.allElementsBoundByIndex.map(\.identifier))
        let rows = rowIDs.map { table.cells[$0].frame }.filter { $0.height > 1 && $0.maxY > 100 && $0.minY < app.frame.height - 100 }
            .sorted { $0.minY < $1.minY }
        for (previous, next) in zip(rows, rows.dropFirst()) {
            XCTAssertLessThanOrEqual(previous.maxY, next.minY + 1, "Self-sizing channel cells cannot overlap")
        }
        let text = Set(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Reply ")).allElementsBoundByIndex.map(\.label))
        let labels = text.map { app.staticTexts.matching(NSPredicate(format: "label == %@", $0)).firstMatch.frame }.filter { $0.height > 1 && $0.minY > 100 && $0.maxY < app.frame.height - 110 }
            .sorted { $0.minY < $1.minY }
        for (previous, next) in zip(labels, labels.dropFirst()) {
            XCTAssertLessThanOrEqual(previous.maxY, next.minY + 1, "Rendered multiline text cannot overlap the next reply")
        }
    }
    private func capture(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
    }
}
