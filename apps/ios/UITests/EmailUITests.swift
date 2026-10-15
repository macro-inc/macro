import XCTest

@MainActor
final class EmailUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testNativeEmailFiltersReaderAndReply() {
        let app = launch()
        attach(app, "Email Signal inbox")
        app.buttons["email-tab-noise"].tap()
        XCTAssertTrue(app.buttons["email-thread-demo-email-update"].waitForExistence(timeout: 4))
        XCTAssertFalse(app.buttons["email-thread-demo-email-design"].exists)
        app.buttons["email-tab-signal"].tap()
        app.buttons["email-filters"].tap()
        attach(app, "Native email account and unread filters")
        app.buttons["email-filters-done"].tap()
        let thread = app.buttons["email-thread-demo-email-design"]
        XCTAssertTrue(thread.waitForExistence(timeout: 4))
        thread.tap()
        let reply = app.buttons["email-reply-demo-email-design-message"]
        XCTAssertTrue(app.staticTexts["email-reader-subject"].waitForExistence(timeout: 5))
        for _ in 0..<3 where !reply.isHittable { app.scrollViews.firstMatch.swipeUp() }
        attach(app, "Reader before reply")
        XCTAssertTrue(reply.waitForExistence(timeout: 5))
        attach(app, "Native email conversation reader")
        app.buttons["email-thread-actions"].tap()
        app.buttons["email-star"].tap()
        reply.tap()
        XCTAssertTrue(app.buttons["email-send"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "email-to").firstMatch.exists)
        app.textViews["email-body"].tap()
        assertKeyboardAccessories(app)
        attach(app, "Native reply composer with keyboard")
        app.buttons["email-compose-close"].tap()
        app.buttons["Discard changes"].tap()
    }

    func testExplicitFixtureSendAppearsInSentAndDraftCanBeSaved() {
        let app = launch()
        app.buttons["workspace-create"].tap()
        attach(app, "Email creation immediately after New")
        XCTAssertTrue(app.buttons["email-send"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.buttons["dock-email"].exists)
        XCTAssertTrue(app.buttons["workspace-create"].exists)
        XCTAssertEqual(app.buttons["workspace-create"].label, "New")
        XCTAssertTrue(app.buttons["email-schedule"].exists)
        let recipient = app.descendants(matching: .any).matching(identifier: "email-to").firstMatch
        recipient.tap(); recipient.typeText("jamie@macro.local")
        let subject = app.descendants(matching: .any).matching(identifier: "email-subject").firstMatch
        subject.tap(); subject.typeText("A native fixture email")
        let body = app.textViews["email-body"]
        body.tap(); body.typeText("Written in a native composer.\nSecond line.")
        assertKeyboardAccessories(app)
        XCTAssertLessThan(recipient.frame.minY - app.buttons["email-compose-close"].frame.maxY, 65, "Switching from native address fields to the body must preserve the envelope position")
        attach(app, "Native email compose")
        app.buttons["email-send"].tap()
        XCTAssertTrue(app.staticTexts["Email sent"].waitForExistence(timeout: 5))
        app.buttons["email-tab-sent"].tap()
        XCTAssertTrue(app.staticTexts["A native fixture email"].waitForExistence(timeout: 4))
        attach(app, "Fixture sent email")
        app.buttons["workspace-create"].tap()
        subject.tap(); subject.typeText("A saved native draft")
        app.buttons["email-compose-close"].tap()
        app.buttons.matching(NSPredicate(format: "label == %@ AND identifier != %@", "Save draft", "email-save-draft")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Draft saved"].waitForExistence(timeout: 5))
        let drafts = app.buttons["email-tab-drafts"]
        app.scrollViews["native-pill-bar"].swipeLeft()
        XCTAssertTrue(drafts.isHittable); drafts.tap()
        XCTAssertTrue(app.staticTexts["A saved native draft"].waitForExistence(timeout: 4))
    }

    func testSignatureAndScheduleSelectionRemainLocalUntilExplicitSend() {
        let app = launch()
        app.buttons["workspace-create"].tap()
        XCTAssertTrue(app.buttons["email-schedule"].waitForExistence(timeout: 4))
        app.buttons["email-schedule"].tap()
        XCTAssertTrue(app.buttons["email-schedule-tomorrow"].waitForExistence(timeout: 3))
        attach(app, "Native email schedule drawer")
        app.buttons["email-schedule-tomorrow"].tap()
        XCTAssertFalse(app.staticTexts["Email sent"].exists)
        app.textViews["email-body"].tap()
        XCTAssertTrue(app.buttons["email-signature-preview"].waitForExistence(timeout: 3))
        XCTAssertGreaterThanOrEqual(app.textFields["email-to"].frame.minY, app.buttons["email-compose-close"].frame.maxY, "Focusing an empty body must not scroll the To row beneath the header")
        app.buttons["email-signature-preview"].tap()
        XCTAssertTrue(app.staticTexts["Alex Morgan\nMacro"].exists)
        attach(app, "Native email signature preview above keyboard")
        app.buttons["email-signature-remove"].tap()
        XCTAssertFalse(app.buttons["email-signature-preview"].exists)
        app.buttons["email-compose-close"].tap()
    }

    func testNativeEmailMentionKeepsReadableDraftAndKeyboardWithoutSending() {
        let app = launch()
        app.buttons["workspace-create"].tap()
        let body = app.textViews["email-body"]
        XCTAssertTrue(body.waitForExistence(timeout: 4)); body.tap(); body.typeText("See @mobile")
        let item = app.cells["mention-option-workspace-design"]
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        XCTAssertTrue(item.isHittable)
        attach(app, "Email full entity mention picker above keyboard")
        item.tap()
        let readable = NSPredicate(format: "value == %@", "See Mobile launch plan ")
        expectation(for: readable, evaluatedWith: body)
        waitForExpectations(timeout: 4)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        XCTAssertFalse((body.value as? String ?? "").contains("<m-"))
        attach(app, "Email native mention inserted without sending")
        app.buttons["email-compose-close"].tap(); app.buttons["Keep on this device"].tap()
        let newEmail = app.buttons["workspace-create"]
        expectation(for: NSPredicate(format: "label CONTAINS[c] %@", "Email"), evaluatedWith: newEmail)
        waitForExpectations(timeout: 4)
        newEmail.tap()
        XCTAssertTrue(body.waitForExistence(timeout: 3)); XCTAssertEqual(body.value as? String, "See Mobile launch plan ")
        app.buttons["email-compose-close"].tap(); app.buttons["Discard changes"].tap()
    }

    func testReaderNavigationAndDonePreserveInboxContext() {
        let app = launch()
        app.buttons["email-thread-demo-email-design"].tap()
        XCTAssertTrue(app.buttons["email-copy-subject"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["email-previous"].isEnabled)
        XCTAssertTrue(app.buttons["email-next"].isEnabled)
        app.buttons["email-copy-subject"].tap()
        XCTAssertEqual(app.buttons["email-copy-subject"].label, "Subject copied")
        app.buttons["email-next"].tap()
        XCTAssertTrue(app.buttons["email-reply-demo-email-launch-message"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["email-next"].isEnabled)
        app.buttons["email-previous"].tap()
        XCTAssertTrue(app.buttons["email-reply-demo-email-design-message"].waitForExistence(timeout: 5))
        app.buttons["email-done"].tap()
        XCTAssertTrue(app.buttons["email-reply-demo-email-launch-message"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["email-previous"].isEnabled)
        app.buttons["email-back"].tap()
        XCTAssertTrue(app.buttons["email-thread-demo-email-launch"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["email-thread-demo-email-design"].exists)
        attach(app, "Inbox after marking the previous email done")
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--workspace-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["dock-email"].waitForExistence(timeout: 10))
        app.buttons["dock-email"].tap()
        XCTAssertTrue(app.buttons["email-thread-demo-email-design"].waitForExistence(timeout: 5))
        return app
    }
    private func attach(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
    private func assertKeyboardAccessories(_ app: XCUIApplication) {
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5), "The screenshot must include the actual keyboard")
        for identifier in ["email-attach", "email-send", "email-compose-close"] {
            let button = app.buttons[identifier]
            XCTAssertTrue(button.waitForExistence(timeout: 3))
            XCTAssertTrue(button.isHittable, "\(identifier) must remain usable while writing")
            XCTAssertLessThanOrEqual(button.frame.maxY, keyboard.frame.minY + 1, "\(identifier) must sit above the keyboard")
        }
        XCTAssertFalse(app.navigationBars.firstMatch.isHittable, "The mobile composer uses floating controls, without a native modal navigation bar")
        XCTAssertLessThan(app.buttons["email-send"].frame.maxY, app.windows.firstMatch.frame.height * 0.25)
    }
}

private extension XCUIApplication {
    func tapCoordinate(x: CGFloat, y: CGFloat) { coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).tap() }
}
