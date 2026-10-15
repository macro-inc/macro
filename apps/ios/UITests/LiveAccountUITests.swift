import XCTest
import UIKit

/// Explicitly opt-in sign-in for same-account device audits. Normal suites skip it.
/// The code is supplied through a private temporary file, never source or test output.
@MainActor
final class LiveAccountUITests: XCTestCase {
    func testSignInForAuthorizedScreenAudit() throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["MACRO_NATIVE_LIVE_LOGIN"] == "1",
              let email = environment["MACRO_NATIVE_LOGIN_EMAIL"],
              let codePath = environment["MACRO_NATIVE_LOGIN_CODE_FILE"] else {
            throw XCTSkip("Live account sign-in requires explicit opt-in.")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let emailField = app.textFields["login-email"]
        if !emailField.waitForExistence(timeout: 8) {
            XCTAssertTrue(app.buttons["dock-home"].exists, "Expected either the sign-in screen or an authenticated workspace")
            return
        }
        emailField.tap(); emailField.typeText(email)
        app.buttons["Continue with email"].tap()
        let codeField = app.textFields["login-code"]
        XCTAssertTrue(codeField.waitForExistence(timeout: 30))
        print("MACRO_NATIVE_CODE_REQUESTED")
        let deadline = Date().addingTimeInterval(240)
        var code: String?
        while Date() < deadline {
            if let value = try? String(contentsOfFile: codePath, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
               value.range(of: #"^\d{6}$"#, options: .regularExpression) != nil { code = value; break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        guard let code else { XCTFail("The authorized sign-in code was not supplied in time"); return }
        try? FileManager.default.removeItem(atPath: codePath)
        let prior = UIPasteboard.general.items
        UIPasteboard.general.string = code
        defer { UIPasteboard.general.items = prior }
        codeField.tap(); codeField.press(forDuration: 1)
        let paste = app.menuItems["Paste"]
        XCTAssertTrue(paste.waitForExistence(timeout: 3))
        paste.tap()
        // Paste keeps the code out of XCTest's typeText activity descriptions.
        app.buttons["Sign in"].tap()
        XCTAssertTrue(app.buttons["dock-home"].waitForExistence(timeout: 30), "The native workspace should open after authorized sign-in")
        print("MACRO_NATIVE_LOGIN_SUCCEEDED")
    }
}
