import XCTest

/// Opt-in, read-only production inspection. Compose inspection never submits or saves a draft.
@MainActor
final class LiveEmailFilesAuditUITests: XCTestCase {
    func testSignedInHomeEmailDocumentAndSearch() throws {
        guard ProcessInfo.processInfo.environment["MACRO_NATIVE_LIVE_AUDIT"] == "1" else { throw XCTSkip("Live inspection requires explicit opt-in.") }
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = []; app.launch()
        XCTAssertTrue(app.buttons["dock-home"].waitForExistence(timeout: 30))
        ready(app, "workspace-list-ready-signal"); capture(app, "Final live Home Signal")

        app.buttons["dock-email"].tap(); ready(app, "email-list-ready")
        capture(app, "Final live Email inbox")
        let thread = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "email-thread-")).firstMatch
        if thread.exists {
            thread.tap()
            XCTAssertTrue(app.staticTexts["email-reader-subject"].waitForExistence(timeout: 10))
            XCTAssertTrue(app.staticTexts.matching(identifier: "email-rendered-body").firstMatch.waitForExistence(timeout: 30))
            settle("Email body formatting") { !app.staticTexts.matching(identifier: "email-render-pending").firstMatch.exists }
            capture(app, "Final live Email reader")
            app.buttons["email-back"].tap()
        }
        app.buttons["workspace-create"].tap()
        XCTAssertTrue(app.buttons["email-compose-close"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["dock-email"].exists)
        capture(app, "Final live Email full-page idle")
        let body = app.textViews["email-body"]
        if (body.value as? String ?? "").isEmpty {
            body.tap(); XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
            body.typeText("@")
            let option = app.cells.matching(NSPredicate(format: "identifier BEGINSWITH %@", "mention-option-")).firstMatch
            XCTAssertTrue(option.waitForExistence(timeout: 15))
            capture(app, "Final live Email native mentions")
            body.typeText(XCUIKeyboardKey.delete.rawValue)
            capture(app, "Final live Email focused signature")
        }
        app.buttons["email-compose-close"].tap()
        if app.buttons["Keep on this device"].waitForExistence(timeout: 1) { app.buttons["Keep on this device"].tap() }

        app.buttons["dock-files"].tap()
        for tab in ["recent", "myFiles", "sharedFiles"] {
            let pill = app.buttons["pill-" + tab]
            XCTAssertTrue(pill.waitForExistence(timeout: 10)); pill.tap()
            ready(app, "workspace-list-ready-" + tab)
            capture(app, "Final live Files " + tab)
            if tab == "myFiles" {
                let document = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "workspace-item-")).firstMatch
                if document.exists {
                    document.tap()
                    XCTAssertTrue(app.buttons["document-back"].waitForExistence(timeout: 30))
                    XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 30))
                    settle("Authenticated document content", timeout: 40) {
                        !app.progressIndicators.firstMatch.exists && (app.webViews.firstMatch.staticTexts.count > 0 || app.webViews.firstMatch.textViews.count > 0)
                    }
                    XCTAssertFalse(app.staticTexts["Sign-in needed"].exists)
                    XCTAssertFalse(app.staticTexts["Couldn’t open workspace"].exists)
                    XCTAssertTrue(app.buttons["dock-files"].exists)
                    capture(app, "Final live Document full-page editor")
                    app.buttons["document-back"].tap(); ready(app, "workspace-list-ready-" + tab)
                }
            }
        }
        app.buttons["dock-search"].tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap()
        capture(app, "Final live Search scopes empty")
        search.typeText("engineers")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label == %@", "Engineers")).firstMatch.waitForExistence(timeout: 30))
        ready(app, "workspace-search-ready")
        capture(app, "Final live Search Featured and More Results")
        app.buttons["workspace-search-close"].tap()
        app.buttons["dock-home"].tap()
    }
    private func ready(_ app: XCUIApplication, _ id: String) { XCTAssertTrue(app.descendants(matching: .any)[id].waitForExistence(timeout: 40)) }
    private func settle(_ message: String, timeout: TimeInterval = 20, condition: @escaping () -> Bool) {
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)], timeout: timeout), .completed, message)
    }
    private func capture(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
    }
}
