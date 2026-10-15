import XCTest

/// Read-only smoke audit against the signed-in phone. Never sends, creates, or deletes user content.
@MainActor
final class PhoneAuditUITests: XCTestCase {
    func testSignedInWorkspaceReadOnly() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("This audit uses the account already signed in on the physical iPhone.")
        #else
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = []; app.launch()
        XCTAssertTrue(app.buttons["dock-home"].waitForExistence(timeout: 20), "The installed app should retain the existing sign-in.")
        capture(app, "Phone - Notifications Signal")
        app.buttons["pill-noise"].tap()
        capture(app, "Phone - Notifications Noise")
        app.buttons["dock-calendar"].tap()
        capture(app, "Phone - Calendar")
        app.buttons["dock-email"].tap()
        capture(app, "Phone - Email")
        app.buttons["dock-files"].tap()
        capture(app, "Phone - Files Recent")
        app.buttons["pill-myFiles"].tap()
        capture(app, "Phone - My files")
        app.buttons["pill-folders"].tap()
        capture(app, "Phone - Folders")
        app.buttons["dock-channels"].tap()
        let channel = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "channel-")).firstMatch
        XCTAssertTrue(channel.waitForExistence(timeout: 15))
        capture(app, "Phone - Channels")
        channel.tap()
        XCTAssertTrue(app.textViews["message-input"].waitForExistence(timeout: 10))
        capture(app, "Phone - Native conversation")
        app.textViews["message-input"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        capture(app, "Phone - Native composer focused")
        app.buttons["channel-back"].tap()
        app.buttons["dock-home"].tap()
        #endif
    }
    private func capture(_ app: XCUIApplication, _ name: String) {
        // Wait on disappearance instead of an unconditional sleep; reads may use cached content.
        let loading = app.progressIndicators.firstMatch
        if loading.exists { _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: loading)], timeout: 15) }
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
}
