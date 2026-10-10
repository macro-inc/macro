import XCTest

@MainActor
final class LiveChannelParityUITests: XCTestCase {
    func testSameAccountChannelNavigationAndReplyAppearance() throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["MACRO_NATIVE_LIVE_AUDIT"] == "1",
              let channelID = environment["MACRO_NATIVE_AUDIT_CHANNEL_ID"], !channelID.isEmpty else {
            throw XCTSkip("Same-account inspection requires explicit opt-in and a configured channel.")
        }
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = []; app.launch()
        XCTAssertTrue(app.buttons["dock-channels"].waitForExistence(timeout: 25)); app.buttons["dock-channels"].tap()
        let channel = app.buttons["channel-" + channelID]
        XCTAssertTrue(channel.waitForExistence(timeout: 25)); capture(app, "Native production channels list")
        channel.tap()
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 15))
        XCTAssertEqual(app.buttons.matching(identifier: "channel-back").count, 1)
        XCTAssertFalse(app.navigationBars.firstMatch.isHittable)
        capture(app, "Native production channel collapsed")
        app.buttons["Channel details"].tap()
        XCTAssertTrue(app.buttons["channel-menu-participants"].waitForExistence(timeout: 5))
        capture(app, "Native production channel title drawer")
        app.buttons["channel-menu-attachments"].tap()
        XCTAssertTrue(app.scrollViews["channel-attachments-view"].waitForExistence(timeout: 8))
        capture(app, "Native production channel media")
        app.buttons["channel-attachments-documents"].tap(); capture(app, "Native production channel documents")
        app.buttons["Channel details"].tap(); app.buttons["channel-menu-calls"].tap()
        XCTAssertTrue(app.scrollViews["channel-calls-view"].waitForExistence(timeout: 8)); capture(app, "Native production channel calls")
        app.buttons["Channel details"].tap(); app.buttons["channel-menu-participants"].tap()
        capture(app, "Native production channel participants")
        app.buttons["Channel details"].tap(); app.buttons["channel-menu-messages"].tap()
        let table = app.tables["message-timeline"]
        XCTAssertTrue(table.waitForExistence(timeout: 8))
        let expanders = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "expand-thread-"))
        if let expand = expanders.allElementsBoundByIndex.last(where: { $0.isHittable }) {
            expand.tap()
            table.swipeUp(velocity: .slow)
            capture(app, "Native production channel expanded inline")
        }
        for _ in 0..<3 { table.swipeUp(velocity: .fast) }
        capture(app, "Native production channel latest replies")
        let reply = app.buttons["Reply in thread"].firstMatch
        if reply.isHittable {
            reply.tap()
            XCTAssertTrue(app.textViews["inline-thread-input"].waitForExistence(timeout: 5))
            capture(app, "Native production unified reply composer")
            app.buttons["inline-thread-close"].tap()
            table.swipeDown(velocity: .slow)
        }
        for _ in 0..<4 { table.swipeDown(velocity: .fast) }
        capture(app, "Native production older channel content while scrolling")
        app.buttons["channel-back"].tap()
        XCTAssertTrue(channel.waitForExistence(timeout: 5))
        channel.tap(); XCTAssertTrue(table.waitForExistence(timeout: 8))
        capture(app, "Native production warm channel reopening")
    }
    private func capture(_ app: XCUIApplication, _ name: String) {
        let loading = app.progressIndicators.firstMatch
        if loading.exists { _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: loading)], timeout: 12) }
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
