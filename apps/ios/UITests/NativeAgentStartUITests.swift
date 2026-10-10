import XCTest

@MainActor
final class NativeAgentStartUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testHomePromptFocusesAndSendsOnlyAfterExplicitSend() {
        let app = launch()
        XCTAssertFalse(app.buttons["ask-ai-send"].isEnabled)
        app.textViews["ask-ai-input"].tap()
        let input = app.textViews["ask-ai-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "Opening the prompt should focus the native composer")
        XCTAssertFalse(app.buttons["ask-ai-send"].isEnabled)
        input.typeText("Plan our iPhone launch")
        XCTAssertTrue(app.buttons["pill-signal"].exists, "Typing Ask AI must keep the current view in place")
        XCTAssertFalse(app.navigationBars["Ask AI"].exists, "Ask AI must not open a generic sheet")
        XCTAssertLessThanOrEqual(app.buttons["ask-ai-send"].frame.maxY, app.keyboards.firstMatch.frame.minY + 1)
        capture(app, "Inline Ask AI remains above keyboard on Home")
        XCTAssertTrue(app.buttons["ask-ai-send"].isEnabled)
        XCTAssertFalse(app.scrollViews["cognition-timeline"].exists)
        app.buttons["ask-ai-send"].tap()
        XCTAssertTrue(app.scrollViews["cognition-timeline"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Plan our iPhone launch"].waitForExistence(timeout: 5))
        capture(app, "Home Ask AI starts a native conversation")
    }

    func testHomePaperclipOpensAttachmentChooserAndReturnsToFocusedDraft() {
        let app = launch()
        app.buttons["ask-ai-attach"].tap()
        XCTAssertTrue(app.buttons["Photo Library"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Choose File"].exists)
        XCTAssertFalse(app.scrollViews["cognition-timeline"].exists)
        capture(app, "Home paperclip opens native attachment choices")
        app.buttons["Cancel"].tap()
        let input = app.textViews["ask-ai-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        input.typeText("Keep this draft")
        app.descendants(matching: .any)["workspace-list-ready-signal"].swipeDown()
        let files = app.buttons["dock-files"]
        for _ in 0..<2 where !files.isHittable { app.descendants(matching: .any)["workspace-list-ready-signal"].swipeDown() }
        XCTAssertTrue(files.isHittable); files.tap(); app.buttons["dock-home"].tap()
        XCTAssertTrue(app.textViews["ask-ai-input"].waitForExistence(timeout: 5)); app.textViews["ask-ai-input"].tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, "Keep this draft")
        // Send only to the in-memory fixture so later tests begin with a clean draft.
        app.buttons["ask-ai-send"].tap()
        XCTAssertTrue(app.scrollViews["cognition-timeline"].waitForExistence(timeout: 5))
    }

    func testHomeMicrophoneInvokesDictationWithoutRequestingPermissionsInFixtures() {
        let app = launch()
        app.buttons["ask-ai-dictate"].tap()
        XCTAssertTrue(app.staticTexts["Dictation is available after signing in."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["ask-ai-dictate"].exists)
        XCTAssertFalse(app.scrollViews["cognition-timeline"].exists)
        XCTAssertFalse(app.buttons["ask-ai-send"].isEnabled)
        capture(app, "Home microphone opens the native dictation composer")
    }

    func testChannelAskMacroStartsFullPageWithContextAndBottomComposer() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing"]; app.launch()
        let channel = app.buttons["channel-01900000-0000-7000-8000-000000000001"]
        XCTAssertTrue(channel.waitForExistence(timeout: 5)); channel.tap()
        XCTAssertTrue(app.buttons["Channel details"].waitForExistence(timeout: 5)); app.buttons["Channel details"].tap()
        let ask = app.buttons["Ask Macro"]; XCTAssertTrue(ask.waitForExistence(timeout: 4)); ask.tap()
        let input = app.textViews["agent-new-composer"]
        XCTAssertTrue(input.waitForExistence(timeout: 5)); XCTAssertTrue(app.buttons["agent-new-back"].exists)
        XCTAssertEqual(app.navigationBars.count, 0); XCTAssertFalse(app.keyboards.firstMatch.exists)
        XCTAssertFalse((input.value as? String ?? "").isEmpty, "Channel context is seeded without sending")
        XCTAssertGreaterThan(input.frame.minY, app.frame.height * 0.6)
        XCTAssertLessThan(app.buttons["agent-new-title"].frame.minY, 100)
        XCTAssertTrue(app.buttons["agent-new-attach"].isHittable)
        XCTAssertFalse(app.buttons["dock-channels"].isSelected, "Cognition is its own detail, so the originating dock tab is neutral")
        capture(app, "Channel Ask Macro matches full-page New Chat")
        app.buttons["cognition-info"].tap()
        let closeInfo = app.buttons["cognition-info-close"]
        XCTAssertTrue(closeInfo.waitForExistence(timeout: 4)); XCTAssertTrue(closeInfo.isHittable)
        XCTAssertFalse(app.buttons["Done"].exists); XCTAssertEqual(app.navigationBars.count, 0)
        capture(app, "Cognition information uses floating glass drawer")
        closeInfo.tap()
        XCTAssertTrue(app.buttons["agent-new-back"].waitForExistence(timeout: 4))
        app.buttons["agent-new-back"].tap()
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.buttons["dock-channels"].isSelected, "Returning to the channel restores dock selection")
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--workspace-testing"]
        app.launch()
        XCTAssertTrue(app.textViews["ask-ai-input"].waitForExistence(timeout: 5))
        return app
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = name; capture.lifetime = .keepAlways; add(capture)
    }
}
