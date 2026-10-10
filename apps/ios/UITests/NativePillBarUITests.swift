import XCTest

@MainActor
final class NativePillBarUITests: XCTestCase {
    func testSelectingTrailingFileTabKeepsEntirePillVisible() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--workspace-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["dock-files"].waitForExistence(timeout: 5)); app.buttons["dock-files"].tap()
        for id in ["myFiles", "sharedFiles", "folders"] {
            let pill = app.buttons["pill-" + id]
            XCTAssertTrue(pill.waitForExistence(timeout: 5)); pill.tap()
            let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                pill.frame.minX >= app.frame.minX + 6 && pill.frame.maxX <= app.frame.maxX - 6
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 3), .completed, "Selected \(id) label should remain fully visible")
        }
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Selected trailing Files pill stays visible"; capture.lifetime = .keepAlways; add(capture)
    }
}
