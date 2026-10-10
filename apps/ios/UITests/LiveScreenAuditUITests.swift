import XCTest

/// Same-account visual inspection. Mutating flows are exercised only by fixture suites.
@MainActor
final class LiveScreenAuditUITests: XCTestCase {
    func testSignedInScreensAndInlineLatestReply() throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["MACRO_NATIVE_LIVE_AUDIT"] == "1",
              let channelID = environment["MACRO_NATIVE_AUDIT_CHANNEL_ID"], !channelID.isEmpty,
              let channelName = environment["MACRO_NATIVE_AUDIT_CHANNEL_NAME"], !channelName.isEmpty,
              let expectedReply = environment["MACRO_NATIVE_AUDIT_REPLY_TEXT"], !expectedReply.isEmpty else {
            throw XCTSkip("The live visual audit requires opt-in channel and expected-reply configuration.")
        }
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = []; app.launch()
        XCTAssertTrue(app.buttons["dock-home"].waitForExistence(timeout: 30))
        waitForWorkspace(app, collection: "signal")
        capture(app, "Live Home Signal")
        let homeEngineers = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "workspace-item-", channelName)).firstMatch
        if homeEngineers.exists {
            homeEngineers.tap()
            XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 15))
            XCTAssertTrue(app.buttons["Channel details"].exists)
            XCTAssertEqual(app.buttons.matching(identifier: "channel-back").count, 1)
            XCTAssertFalse(app.navigationBars.firstMatch.isHittable, "Home channel routes should use one floating header")
            capture(app, "Live Home to configured channel")
            app.buttons["channel-back"].tap()
        }
        app.buttons["pill-noise"].tap(); waitForWorkspace(app, collection: "noise"); capture(app, "Live Home Noise")
        app.buttons["dock-calendar"].tap()
        XCTAssertTrue(app.buttons["calendar-filter"].waitForExistence(timeout: 10))
        for period in ["day", "week", "month"] {
            app.buttons["calendar-filter"].tap(); app.buttons["calendar-period-" + period].tap()
            capture(app, "Live Calendar " + period)
        }
        app.buttons["dock-email"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["email-list-ready"].waitForExistence(timeout: 30), "Email must complete its first query before capture")
        capture(app, "Live Email Signal")
        let email = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "email-thread-")).firstMatch
        if email.exists {
            email.tap(); XCTAssertTrue(app.buttons["email-back"].waitForExistence(timeout: 10))
            XCTAssertTrue(app.staticTexts.matching(identifier: "email-rendered-body").firstMatch.waitForExistence(timeout: 30))
            waitUntil("All visible email bodies should finish native formatting") {
                !app.staticTexts.matching(identifier: "email-render-pending").firstMatch.exists
            }
            let subject = app.staticTexts["email-reader-subject"]
            if let expectedSubject = environment["MACRO_NATIVE_AUDIT_EMAIL_SUBJECT"],
               let styledText = environment["MACRO_NATIVE_AUDIT_EMAIL_STYLED_TEXT"],
               subject.label == expectedSubject {
                let body = app.staticTexts.matching(identifier: "email-rendered-body").firstMatch.label
                XCTAssertTrue(body.contains(styledText)); XCTAssertFalse(body.contains("*" + styledText + "*"))
            }
            capture(app, "Live Email Reader"); app.buttons["email-back"].tap()
        }
        app.buttons["workspace-create"].tap()
        XCTAssertTrue(app.buttons["email-compose-close"].waitForExistence(timeout: 5))
        capture(app, "Live Email Full Page Composer Idle")
        let emailBody = app.textViews["email-body"]
        let priorDraft = emailBody.value as? String ?? ""
        if priorDraft.isEmpty {
            emailBody.tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
            capture(app, "Live Email Full Page Composer Focused")
            emailBody.typeText("@")
            XCTAssertTrue(app.cells.matching(NSPredicate(format: "identifier BEGINSWITH %@", "mention-option-")).firstMatch.waitForExistence(timeout: 15))
            capture(app, "Live Email Native Mention Menu")
            emailBody.typeText(XCUIKeyboardKey.delete.rawValue)
        }
        app.buttons["email-compose-close"].tap()
        if app.buttons["Keep on this device"].waitForExistence(timeout: 1) { app.buttons["Keep on this device"].tap() }
        app.buttons["dock-files"].tap()
        for filter in ["recent", "myFiles", "sharedFiles", "folders"] {
            XCTAssertTrue(app.buttons["pill-" + filter].waitForExistence(timeout: 10))
            app.buttons["pill-" + filter].tap()
            waitForWorkspace(app, collection: filter)
            capture(app, "Live Files " + filter)
            if filter == "myFiles" {
                let document = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "workspace-item-")).firstMatch
                if document.exists {
                    document.tap()
                    XCTAssertTrue(app.buttons["document-back"].waitForExistence(timeout: 30))
                    XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 30))
                    XCTAssertTrue(app.buttons["dock-files"].exists, "Document editing stays inside the Files navigation stack")
                    waitUntil("Document should finish its initial authenticated page load", timeout: 30) { !app.progressIndicators.firstMatch.exists }
                    capture(app, "Live Document Full Native Page")
                    app.buttons["dock-files"].tap()
                    waitForWorkspace(app, collection: filter)
                }
            }
        }
        app.buttons["dock-channels"].tap()
        let engineers = app.buttons["channel-" + channelID]
        XCTAssertTrue(engineers.waitForExistence(timeout: 20)); capture(app, "Live Channels")
        engineers.tap()
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 10))
        let latest = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", expectedReply)).firstMatch
        if !latest.waitForExistence(timeout: 3) {
            let expanders = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "expand-thread-"))
            XCTAssertTrue(expanders.firstMatch.waitForExistence(timeout: 20), "Collapsed replies should have an inline expand control")
            for button in expanders.allElementsBoundByIndex.reversed() where button.isHittable {
                button.tap()
                if latest.waitForExistence(timeout: 3) { break }
            }
        }
        XCTAssertTrue(latest.waitForExistence(timeout: 25), "The configured reply must appear inline after expanding the preview")
        XCTAssertTrue(app.textViews["message-input"].exists, "Expanding replies must keep the main channel open")
        capture(app, "Live channel with configured reply")
        app.buttons["channel-back"].tap()
        if let secondaryID = environment["MACRO_NATIVE_AUDIT_SECONDARY_CHANNEL_ID"],
           app.buttons["channel-" + secondaryID].exists {
            let featureRequests = app.buttons["channel-" + secondaryID]
            featureRequests.tap(); XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 10))
            capture(app, "Live secondary channel")
            app.buttons["channel-back"].tap()
        }
        app.buttons["dock-more"].tap(); capture(app, "Live More")
        app.buttons["Settings"].tap(); XCTAssertTrue(app.staticTexts["settings-heading"].waitForExistence(timeout: 5))
        capture(app, "Live Settings")
        app.buttons["settings-profile"].tap()
        XCTAssertTrue(app.textFields["profile-first-name"].waitForExistence(timeout: 10))
        waitUntil("Profile should finish loading without editing it") { app.buttons["profile-save"].isEnabled }
        capture(app, "Live Settings Account")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["settings-appearance"].tap()
        XCTAssertTrue(app.buttons["appearance-system"].waitForExistence(timeout: 5))
        capture(app, "Live Settings Appearance")
        app.navigationBars.buttons.element(boundBy: 0).tap(); app.buttons["settings-close"].tap()

        if app.buttons["dock-agents"].exists { app.buttons["dock-agents"].tap() }
        else { app.buttons["dock-more"].tap(); app.buttons["Agents"].tap() }
        waitForWorkspace(app, collection: "agents"); capture(app, "Live Agents List")
        let agent = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "workspace-item-")).firstMatch
        if agent.exists {
            agent.tap(); XCTAssertTrue(app.scrollViews["agent-timeline"].waitForExistence(timeout: 10))
            waitUntil("Agent transcript should complete its first load", timeout: 40) {
                app.textViews["agent-composer"].exists || app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "agent-part-")).firstMatch.exists
            }
            capture(app, "Live Agent Conversation")
        }
        app.buttons["dock-search"].tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap(); search.typeText(channelName)
        XCTAssertTrue(app.buttons["search-scope-all"].exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label == %@", channelName)).firstMatch.waitForExistence(timeout: 30))
        capture(app, "Live Native Search")
        if let secondaryName = environment["MACRO_NATIVE_AUDIT_SECONDARY_CHANNEL_NAME"], !secondaryName.isEmpty {
            search.tap()
            let current = search.value as? String ?? channelName
            search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count) + secondaryName)
            let secondary = app.staticTexts.matching(NSPredicate(format: "label == %@", secondaryName)).firstMatch
            XCTAssertTrue(secondary.waitForExistence(timeout: 30)); secondary.tap()
            XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 15))
            XCTAssertFalse(app.webViews.firstMatch.exists, "Channel search results must open the native timeline.")
            capture(app, "Live secondary channel through search")
            app.buttons["channel-back"].tap()
        } else { app.buttons["workspace-search-close"].tap() }
        app.buttons["dock-home"].tap()
    }

    private func waitForWorkspace(_ app: XCUIApplication, collection: String) {
        XCTAssertTrue(app.descendants(matching: .any)["workspace-list-ready-" + collection].waitForExistence(timeout: 40), "The \(collection) query must settle before capture")
    }

    private func waitUntil(_ message: String, timeout: TimeInterval = 20, condition: @escaping () -> Bool) {
        let complete = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [complete], timeout: timeout), .completed, message)
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let loading = app.progressIndicators.firstMatch
        if loading.exists {
            _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: loading)], timeout: 15)
        }
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
    }
}
