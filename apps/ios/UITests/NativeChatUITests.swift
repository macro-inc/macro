import XCTest

@MainActor
final class NativeChatUITests: XCTestCase {
    private let channelID = "01900000-0000-7000-8000-000000000001"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testNativeComposerSendsAndReceivesWithoutDismissingKeyboard() {
        let app = launch()
        attach(app, name: "01 Native conversation list")
        openChannel(in: app)
        attach(app, name: "02 Product and design channel")
        let input = app.textViews["message-input"]
        input.tap()
        input.typeText("A fast native message")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        attach(app, name: "03 Native composer and keyboard")
        app.buttons["send-message"].tap()

        XCTAssertTrue(app.staticTexts["A fast native message"].waitForExistence(timeout: 2))
        waitForValue("", of: input)
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Sending must keep the native keyboard open")
        XCTAssertTrue(app.staticTexts["Received — that was quick!"].waitForExistence(timeout: 6))
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", "A fast native message")).count, 1)
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Receiving must preserve composer focus")
        let incoming = app.staticTexts["Received — that was quick!"].firstMatch
        XCTAssertTrue(incoming.isHittable, "The newest reply should remain visible above the keyboard.")
        XCTAssertLessThanOrEqual(incoming.frame.maxY, input.frame.minY - 4, "Latest text must sit above the floating composer.")
        XCTAssertFalse(app.buttons["jump-to-latest"].isHittable)
        attach(app, name: "04 Sent and received with keyboard retained")
    }

    func testConsecutiveAndMultilineMessagesKeepTheComposerReady() {
        let app = launch()
        openChannel(in: app)
        let input = app.textViews["message-input"]
        input.tap()
        input.typeText("First quick thought")
        app.buttons["send-message"].tap()
        waitForValue("", of: input)

        input.typeText("Second thought\nWith a second line")
        XCTAssertTrue(app.buttons["send-message"].isEnabled)
        app.buttons["send-message"].tap()
        waitForValue("", of: input)
        XCTAssertTrue(app.staticTexts["Second thought\nWith a second line"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.keyboards.firstMatch.exists)

        input.typeText("Already writing the next one")
        waitForValue("Already writing the next one", of: input)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label == %@", "Received — that was quick!")).firstMatch.waitForExistence(timeout: 6))
        waitForValue("Already writing the next one", of: input)
        attach(app, name: "Consecutive multiline sends preserve the next draft")
    }

    func testFailedSendRetriesWithoutDuplicatingTheMessage() {
        let app = launch(extraArguments: ["--test-send-failure"])
        openChannel(in: app)
        let input = app.textViews["message-input"]
        input.tap()
        input.typeText("Keep this message if the network fails")
        app.buttons["send-message"].tap()
        waitForValue("", of: input)

        let retry = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "retry-")).firstMatch
        XCTAssertTrue(retry.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Keep this message if the network fails"].exists)
        attach(app, name: "Failed send remains in the conversation")
        retry.tap()
        waitFor(NSPredicate(format: "exists == false"), object: retry)
        XCTAssertTrue(app.staticTexts["Received — that was quick!"].waitForExistence(timeout: 6))
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", "Keep this message if the network fails")).count, 1)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
    }

    func testUnsentDraftSurvivesLeavingAndReopeningTheChannel() {
        let app = launch()
        openChannel(in: app)
        let input = app.textViews["message-input"]
        input.tap()
        input.typeText("A draft I will finish later\nWith its formatting")
        app.buttons["channel-back"].tap()
        XCTAssertTrue(channel(in: app).waitForExistence(timeout: 3))
        openChannel(in: app)
        waitForValue("A draft I will finish later\nWith its formatting", of: app.textViews["message-input"])
        XCTAssertTrue(app.buttons["send-message"].isEnabled)
    }

    func testNativeMentionSelectionKeepsKeyboardAndSendsReadableMention() {
        let app = launch()
        openChannel(in: app)
        let input = app.textViews["message-input"]
        input.tap()
        input.typeText("Hey @jam")
        let candidate = app.cells["mention-option-macro|jamie@macro.local"]
        XCTAssertTrue(candidate.waitForExistence(timeout: 3))
        attach(app, name: "Native mention search above the composer")
        candidate.tap()
        waitForValue("Hey @Jamie Chen ", of: input)
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Selecting a mention must preserve keyboard focus")
        input.typeText("take a look")
        app.buttons["send-message"].tap()
        waitForValue("", of: input)
        XCTAssertTrue(app.staticTexts["Hey @Jamie Chen take a look"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "<m-user-mention>")).firstMatch.exists)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        attach(app, name: "Mention sent as a readable native message")
    }

    func testMixedMentionPickerSelectsEveryWorkspaceEntityWithoutSending() {
        let app = launch()
        openChannel(in: app)
        let input = app.textViews["message-input"]
        input.tap()
        var draft = ""
        let selections = [
            ("jam", "macro|jamie@macro.local", "@Jamie Chen"),
            ("prod", channelID, "#Product & design"),
            ("mobile", "workspace-design", "Mobile launch plan"),
            ("few thoughts", "demo-email-design", "A few thoughts on the mobile design"),
            ("Launch", "workspace-folder", "Launch"),
            ("Review the iPhone", "workspace-task", "Review the iPhone experience"),
            ("Research launch", "workspace-agent", "Research launch checklist")
        ]
        for (query, id, label) in selections {
            input.typeText("@" + query)
            let candidate = app.cells["mention-option-" + id]
            XCTAssertTrue(candidate.waitForExistence(timeout: 5), "Expected a matching entity for \(query)")
            XCTAssertTrue(candidate.isHittable)
            if id == "workspace-design" || id == "demo-email-design" {
                attach(app, name: "Mixed mention results for " + query)
            }
            candidate.tap()
            draft += label + " "
            waitForValue(draft, of: input)
            XCTAssertTrue(app.keyboards.firstMatch.exists, "Selecting \(label) must preserve focus")
            XCTAssertFalse(app.tables["mention-results"].isHittable, "The picker must close after selecting a token")
        }
        input.typeText("@Tomorrow")
        let tomorrow = app.cells.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label BEGINSWITH[c] %@", "mention-option-", "Tomorrow")).firstMatch
        XCTAssertTrue(tomorrow.waitForExistence(timeout: 5))
        tomorrow.tap()
        waitForValue(draft + "Tomorrow ", of: input)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        XCTAssertFalse((input.value as? String ?? "").contains("<m-"))
        attach(app, name: "People channels files email folders tasks agents and dates in one native draft")
    }

    func testLoadingEarlierMessagesPreservesTheReadingPositionAndDraft() {
        let app = launch()
        openChannel(in: app)
        let input = app.textViews["message-input"]
        input.tap()
        input.typeText("Keep this draft while I read")
        let timeline = app.tables["message-timeline"]
        let older = app.buttons["load-older"]
        for _ in 0..<16 where !older.isHittable { timeline.swipeDown() }
        XCTAssertTrue(older.isHittable, "The first page must expose older history")
        let anchor = app.descendants(matching: .any).matching(identifier: "message-fixture-26").firstMatch
        XCTAssertTrue(anchor.exists)
        let anchorY = anchor.frame.minY
        attachViewport(app, timeline: timeline, anchor: anchor, older: older, name: "Before loading earlier history")
        older.tap()
        waitFor(NSPredicate(format: "hittable == false"), object: older)
        XCTAssertTrue(anchor.exists, "Loading history must preserve the currently visible message")
        attachViewport(app, timeline: timeline, anchor: anchor, older: older, name: "After loading earlier history")
        XCTAssertEqual(anchor.frame.minY, anchorY, accuracy: 35, "Loading earlier history must not jump the viewport")
        waitForValue("Keep this draft while I read", of: input)

        timeline.swipeDown()
        let earlier = app.descendants(matching: .any).matching(identifier: "message-fixture-25").firstMatch
        XCTAssertTrue(earlier.waitForExistence(timeout: 3), "The preceding page must be reachable")
        attach(app, name: "Earlier history loads without losing the draft")
    }

    private func launch(extraArguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        // Fixture mode prohibits native authentication and all real message traffic.
        app.launchArguments = ["--ui-testing"] + extraArguments
        app.launch()
        XCTAssertTrue(channel(in: app).waitForExistence(timeout: 10))
        return app
    }

    private func channel(in app: XCUIApplication) -> XCUIElement {
        app.buttons["channel-\(channelID)"]
    }

    private func openChannel(in app: XCUIApplication) {
        channel(in: app).tap()
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.tables["message-timeline"].waitForExistence(timeout: 5))
    }

    private func waitForValue(_ value: String, of element: XCUIElement) {
        waitFor(NSPredicate(format: "value == %@", value), object: element)
    }

    private func waitFor(_ predicate: NSPredicate, object: XCUIElement, timeout: TimeInterval = 5) {
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: object)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed)
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func attachViewport(_ app: XCUIApplication, timeline: XCUIElement, anchor: XCUIElement,
                                older: XCUIElement, name: String) {
        attach(app, name: name)
        let children = anchor.staticTexts.allElementsBoundByIndex.map { "\($0.label): \($0.frame)" }.joined(separator: "\n")
        let row = timeline.cells.containing(.any, identifier: "message-fixture-26").firstMatch
        let details = """
        \(name)
        table: \(timeline.frame)
        anchor container: \(anchor.frame)
        enclosing row: \(row.exists ? String(describing: row.frame) : "not found")
        older: \(older.exists ? String(describing: older.frame) : "not found"), hittable: \(older.isHittable)
        input: \(app.textViews["message-input"].frame)
        keyboard visible: \(app.keyboards.firstMatch.exists)
        anchor children:
        \(children)
        """
        print(details)
        let attachment = XCTAttachment(string: details)
        attachment.name = name + " frames"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
