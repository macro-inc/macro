import XCTest

@MainActor
final class ChannelParityUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testLeftSwipeOpensFocusedInlineReplyWithoutThreadNavigation() {
        let app = openChannel()
        let message = lastMessage(in: app)
        message.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.55))
            .press(forDuration: 0.05, thenDragTo: message.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.55)))
        let reply = app.textViews["inline-thread-input"]
        XCTAssertTrue(reply.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3), "Swiping to reply focuses the native input once mounted.")
        XCTAssertTrue(reply.isHittable, "The inline composer should be scrolled above the keyboard.")
        XCTAssertFalse(app.navigationBars["Thread"].exists)
        XCTAssertFalse(app.textViews["message-input"].isHittable, "Only the active composer should be visible.")
        XCTAssertTrue(app.buttons["channel-back"].exists)
        attach(app, "Swipe to reply stays in the channel rail")
        app.buttons["inline-thread-close"].tap()
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 4))
        XCTAssertFalse(reply.exists)
    }

    func testLongPressDrawerOffersQuickAndSearchableReactionsAndMessageActions() {
        let app = openChannel()
        lastMessage(in: app).press(forDuration: 0.65)
        let reply = app.buttons["message-action-reply"]
        XCTAssertTrue(reply.waitForExistence(timeout: 4))
        for action in ["copy-text", "copy-link", "create-task", "edit", "delete"] {
            XCTAssertTrue(app.buttons["message-action-" + action].exists)
        }
        for emoji in ["❤️", "👍", "👎", "😂", "😡"] { XCTAssertTrue(app.buttons["message-react-" + emoji].exists) }
        XCTAssertTrue(app.buttons["message-more-reactions"].exists)
        attach(app, "Native long-press action drawer")
        app.buttons["message-react-👍"].tap()
        XCTAssertTrue(app.buttons["👍 1"].waitForExistence(timeout: 4))
        lastMessage(in: app).press(forDuration: 0.65)
        XCTAssertTrue(app.buttons["message-more-reactions"].waitForExistence(timeout: 4))
        app.buttons["message-more-reactions"].tap()
        let search = app.textFields["message-emoji-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 3)); search.tap(); search.typeText("rocket")
        let rocket = app.buttons["message-emoji-1F680"]
        XCTAssertTrue(rocket.waitForExistence(timeout: 4)); XCTAssertTrue(rocket.isHittable)
        attach(app, "Search every native reaction emoji")
        rocket.tap()
        XCTAssertTrue(app.buttons["🚀 1"].waitForExistence(timeout: 4))
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }

    func testChannelFloatingHeaderDockAndComposerKeepOriginalSizes() {
        let app = openChannel()
        let back = app.buttons["channel-back"]
        XCTAssertEqual(back.frame.height, 42.5, accuracy: 1)
        XCTAssertLessThan(back.frame.minY, 90, "Floating header is immediately below the status bar, not padded twice")
        XCTAssertTrue(app.buttons["Channel details"].exists)
        XCTAssertTrue(app.buttons["Add people"].exists)
        XCTAssertTrue(app.buttons["Call"].exists)
        let dock = app.buttons["dock-channels"]
        XCTAssertTrue(dock.waitForExistence(timeout: 4))
        XCTAssertEqual(dock.frame.height, 46, accuracy: 1)
        XCTAssertEqual(app.frame.maxY - dock.frame.maxY, 28, accuracy: 1)
        let composer = app.textViews["message-input"]
        // Production touch h-12.5 uses the 17pt system rem: 50 * 17 / 16.
        XCTAssertEqual(composer.frame.height, 53.125, accuracy: 2)
        XCTAssertLessThan(composer.frame.maxY, dock.frame.minY)
        attach(app, "Channel original header and floating dock dimensions")
        composer.tap()
        composer.typeText("Draft")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        XCTAssertGreaterThan(app.keyboards.firstMatch.frame.height, 100, "Verify the software keyboard is actually onscreen.")
        let dockHidden = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == false"), object: dock)
        XCTAssertEqual(XCTWaiter.wait(for: [dockHidden], timeout: 4), .completed)
        XCTAssertLessThanOrEqual(composer.frame.maxY, app.keyboards.firstMatch.frame.minY)
        XCTAssertTrue(back.isHittable)
        attach(app, "Channel native composer above keyboard")
    }

    func testOwnedMessageEditsInlineAndPreservesTheMainDraft() {
        let app = openChannel()
        let main = app.textViews["message-input"]
        main.tap(); main.typeText("Keep my unsent channel draft")
        // The table extends under the floating composer. A partly covered row
        // can report hittable while its center is beneath the keyboard.
        let ownIDs = stride(from: 45, through: 30, by: -3).map { "message-fixture-\($0)" }
        guard let owned = ownIDs.map({ app.descendants(matching: .any).matching(identifier: $0).firstMatch }).first(where: {
            $0.exists && $0.frame.minY > 120 && $0.frame.maxY < main.frame.minY - 4
        }) else { XCTFail("An owned message must be fully visible above the composer"); return }
        print("EDIT TARGET \(owned.frame) INPUT \(main.frame) KEYBOARD \(app.keyboards.firstMatch.exists ? app.keyboards.firstMatch.frame : .zero)")
        attach(app, "Owned message before edit drawer")
        owned.press(forDuration: 0.65)
        let edit = app.buttons["message-action-edit"]
        attach(app, "Owned message after long press")
        XCTAssertTrue(edit.waitForExistence(timeout: 4)); edit.tap()
        let input = app.textViews["edit-message-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 4))
        let original = input.value as? String ?? ""
        XCTAssertFalse(original.isEmpty)
        input.tap(); input.typeText(" Updated inline.")
        attach(app, "Edit uses the same full-width channel composer")
        app.buttons["inline-thread-send"].tap()
        XCTAssertTrue(app.staticTexts[original + " Updated inline."].waitForExistence(timeout: 5))
        XCTAssertFalse(input.exists)
        XCTAssertEqual(main.value as? String, "Keep my unsent channel draft")
        XCTAssertFalse(app.navigationBars["Thread"].exists)
    }

    private func openChannel() -> XCUIApplication {
        let app = XCUIApplication()
        // Fixture transport never authenticates or contacts production.
        app.launchArguments = ["--ui-testing"]
        app.launch()
        let channel = app.buttons["channel-01900000-0000-7000-8000-000000000001"]
        XCTAssertTrue(channel.waitForExistence(timeout: 6)); channel.tap()
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 5))
        return app
    }
    private func lastMessage(in app: XCUIApplication) -> XCUIElement {
        let message = app.descendants(matching: .any).matching(identifier: "message-fixture-45").firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 4)); XCTAssertTrue(message.isHittable)
        return message
    }
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
