import XCTest

@MainActor
final class NativeAgentUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testExistingAgentTranscriptAndPromptStayNative() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--workspace-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["dock-more"].waitForExistence(timeout: 5))
        openAgents(in: app)
        let row = app.buttons["workspace-item-workspace-agent"]
        XCTAssertTrue(row.waitForExistence(timeout: 5)); row.tap()
        XCTAssertTrue(app.scrollViews["agent-timeline"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.webViews.firstMatch.exists)
        let composer = app.textFields["agent-composer"]
        let multiline = app.textViews["agent-composer"]
        let input = composer.waitForExistence(timeout: 2) ? composer : multiline
        XCTAssertTrue(input.waitForExistence(timeout: 3))
        input.tap(); input.typeText("Review the iPhone launch checklist")
        app.buttons["agent-send"].tap()
        XCTAssertTrue(app.staticTexts["Review the iPhone launch checklist"].waitForExistence(timeout: 5))
        let answer = app.staticTexts["I’ll help you with that. Your message is in this native conversation."]
        XCTAssertTrue(answer.waitForExistence(timeout: 5))
        XCTAssertFalse(app.webViews.firstMatch.exists)
        attach(app, "Native agent transcript and composer")
    }

    func testAskAICreatesNativeMacroConversation() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--workspace-testing"]
        app.launch()
        XCTAssertTrue(app.textViews["ask-ai-input"].waitForExistence(timeout: 5)); app.textViews["ask-ai-input"].tap()
        let field = app.textFields["ask-ai-input"]
        let multiline = app.textViews["ask-ai-input"]
        let input = field.waitForExistence(timeout: 2) ? field : multiline
        XCTAssertTrue(input.waitForExistence(timeout: 5)); input.tap(); input.typeText("Help me plan a native mobile launch")
        app.buttons["ask-ai-send"].tap()
        XCTAssertTrue(app.scrollViews["cognition-timeline"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Help me plan a native mobile launch"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.webViews.firstMatch.exists)
        attach(app, "Ask AI opens a native Macro conversation")
    }

    func testAgentToolsModelsStopAndNativeChangesAndAttachmentMenus() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--workspace-testing", "--test-agent-working"]
        app.launch()
        XCTAssertTrue(app.buttons["dock-more"].waitForExistence(timeout: 5)); openAgents(in: app)
        let row = app.buttons["workspace-item-workspace-agent"]
        XCTAssertTrue(row.waitForExistence(timeout: 5)); row.tap()
        XCTAssertTrue(app.buttons["agent-stop"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["agent-back"].frame.height, 42.5, accuracy: 1)
        XCTAssertEqual(app.buttons["agent-title"].frame.height, 42.5, accuracy: 1)
        XCTAssertEqual(app.buttons["agent-info"].frame.height, 42.5, accuracy: 1)
        XCTAssertLessThan(app.buttons["agent-title"].frame.minY, 100, "Agent title belongs to the floating header, without a second navigation bar")
        XCTAssertTrue(app.staticTexts["Called 2 tools"].exists)
        app.buttons["agent-model-picker"].tap()
        XCTAssertTrue(app.buttons["Fast"].waitForExistence(timeout: 3)); app.buttons["Fast"].tap()
        let attachButton = app.buttons["agent-attach"]
        XCTAssertTrue(attachButton.waitForExistence(timeout: 3))
        XCTAssertGreaterThanOrEqual(attachButton.frame.width, 43.5)
        XCTAssertGreaterThanOrEqual(attachButton.frame.height, 43.5)
        attachButton.tap()
        XCTAssertTrue(app.buttons["Photo Library"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Choose File"].exists)
        attach(app, "Native agent attachment menu")
        app.buttons["Cancel"].tap()
        app.buttons["agent-dictate"].tap()
        XCTAssertTrue(app.staticTexts["Dictation is available after signing in."].waitForExistence(timeout: 3))
        let review = app.buttons["agent-review-changes"]
        XCTAssertTrue(review.waitForExistence(timeout: 5)); review.tap()
        XCTAssertTrue(app.scrollViews["agent-changes-diff"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["launch-checklist.md"].exists)
        XCTAssertFalse(app.webViews.firstMatch.exists)
        attach(app, "Native agent changes review")
        app.buttons["Done"].tap()
        app.buttons["agent-stop"].tap()
        let stopped = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["agent-stop"])
        XCTAssertEqual(XCTWaiter.wait(for: [stopped], timeout: 5), .completed)
        attach(app, "Native agent tools and glass composer")
    }

    private func openAgents(in app: XCUIApplication) {
        if app.buttons["dock-agents"].exists { app.buttons["dock-agents"].tap() }
        else { app.buttons["dock-more"].tap(); app.buttons["Agents"].tap() }
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
