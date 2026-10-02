import XCTest

@MainActor
final class ThreadUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testCollapsedPreviewExpandsAllRepliesInsideTheChannel() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--test-collapsed-thread"]
        app.launch()
        let channel = app.buttons["channel-01900000-0000-7000-8000-000000000001"]
        XCTAssertTrue(channel.waitForExistence(timeout: 6)); channel.tap()
        let expand = app.buttons["expand-thread-fixture-45"]
        XCTAssertTrue(expand.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Inline reply 3"].exists)
        XCTAssertFalse(app.staticTexts["Inline reply 5"].exists)
        XCTAssertTrue(expand.label.contains("2 more replies"))
        attach(app, "Tauri collapsed thread preview and participant indicator")
        expand.tap()
        XCTAssertTrue(app.staticTexts["Inline reply 5"].waitForExistence(timeout: 5))
        XCTAssertFalse(expand.exists)
        XCTAssertFalse(app.navigationBars["Thread"].exists)
        app.buttons["channel-back"].tap()
        XCTAssertTrue(channel.waitForExistence(timeout: 3)); channel.tap()
        XCTAssertTrue(app.staticTexts["Inline reply 5"].waitForExistence(timeout: 5))
        XCTAssertFalse(expand.exists, "Expanded thread state survives leaving and reopening the channel.")
        attach(app, "Expanded replies stay inline across channel navigation")
    }

    func testNativeThreadMentionSendReactionAndKeyboard() {
        let app = openThread()
        attach(app, "Native thread root and reply composer")
        let input = app.textViews["inline-thread-input"]
        input.tap(); input.typeText("Replying to @jam")
        let candidate = app.cells["mention-option-macro|jamie@macro.local"]
        XCTAssertTrue(candidate.waitForExistence(timeout: 4))
        let picker = app.descendants(matching: .any)["mention-picker"].firstMatch
        XCTAssertLessThanOrEqual(picker.frame.maxY, input.frame.minY, "The mention list floats above the input rather than expanding it")
        attach(app, "Thread native mention picker")
        candidate.tap()
        waitForValue("Replying to @Jamie Chen ", of: input)
        input.typeText("inside this thread")
        app.buttons["inline-thread-send"].tap()
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 4), "Sending exits reply mode like production")
        let message = app.staticTexts["Replying to @Jamie Chen inside this thread"]
        XCTAssertTrue(message.waitForExistence(timeout: 4))
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Sending a reply must preserve native keyboard focus")
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", message.label)).count, 1)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "<m-user-mention>")).firstMatch.exists)
        attach(app, "Native thread reply sent with readable mention")
        XCTAssertTrue(app.staticTexts["Received — that was quick!"].waitForExistence(timeout: 5), "Incoming thread replies must appear inline immediately.")

        message.press(forDuration: 1)
        let thumbs = app.buttons["message-react-👍"]
        XCTAssertTrue(thumbs.waitForExistence(timeout: 4)); thumbs.tap()
        let reaction = app.buttons.matching(NSPredicate(format: "label == %@", "👍 1")).firstMatch
        XCTAssertTrue(reaction.waitForExistence(timeout: 4))
        XCTAssertEqual(reaction.label, "👍 1")
        attach(app, "Native thread reaction")
        reaction.tap()
        waitFor(NSPredicate(format: "exists == false"), element: reaction)
    }

    func testFailedReplyRetriesSameBubbleAndPreservesDraftAcrossClosingThread() {
        let app = openThread(extraArguments: ["--test-thread-send-failure"])
        let input = app.textViews["inline-thread-input"]
        input.tap(); input.typeText("A reply that survives a connection error")
        app.buttons["inline-thread-send"].tap()
        let retry = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "retry-")).firstMatch
        XCTAssertTrue(retry.waitForExistence(timeout: 4))
        XCTAssertTrue(app.staticTexts["A reply that survives a connection error"].exists)
        attach(app, "Failed thread reply remains available to retry")
        retry.tap()
        waitFor(NSPredicate(format: "exists == false"), element: retry)
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", "A reply that survives a connection error")).count, 1)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        openLastMessageThread(in: app)
        app.textViews["inline-thread-input"].typeText("Keep this thread draft")
        app.buttons["inline-thread-close"].tap()
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 4))
        openLastMessageThread(in: app)
        waitForValue("Keep this thread draft", of: app.textViews["inline-thread-input"])
        attach(app, "Thread draft survives closing and reopening")
    }

    private func openThread(extraArguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        // The explicit demo session cannot authenticate or use real message transport.
        app.launchArguments = ["--ui-testing"] + extraArguments
        app.launch()
        let channel = app.buttons["channel-01900000-0000-7000-8000-000000000001"]
        XCTAssertTrue(channel.waitForExistence(timeout: 6)); channel.tap()
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 5))
        openLastMessageThread(in: app)
        return app
    }

    private func openLastMessageThread(in app: XCUIApplication) {
        let root = app.descendants(matching: .any).matching(identifier: "message-fixture-45").firstMatch
        XCTAssertTrue(root.waitForExistence(timeout: 4)); root.press(forDuration: 1)
        let reply = app.buttons["message-action-reply"]
        XCTAssertTrue(reply.waitForExistence(timeout: 4)); reply.tap()
        XCTAssertTrue(app.textViews["inline-thread-input"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Thread"].exists, "Replies remain inside the channel timeline.")
        XCTAssertTrue(app.buttons["inline-thread-close"].exists)
        let composer = app.descendants(matching: .any)["unified-thread-composer"].firstMatch
        XCTAssertGreaterThan(composer.frame.width, app.frame.width - 30, "Reply uses the full-width accessory, never a thread cell")
    }

    private func waitForValue(_ value: String, of element: XCUIElement) {
        waitFor(NSPredicate(format: "value == %@", value), element: element)
    }
    private func waitFor(_ predicate: NSPredicate, element: XCUIElement) {
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 5), .completed)
    }
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
