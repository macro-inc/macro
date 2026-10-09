import XCTest

final class OverlayGestureTests: XCTestCase {
    @MainActor
    func testParticipantTapAndScrollDoNotCompete() {
        let app = XCUIApplication()
        app.launch()
        let row = app.scrollViews["call.participant-row"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).tap()
        let primary = app.staticTexts["call.primary-participant"]
        XCTAssertTrue(primary.waitForExistence(timeout: 5))
        XCTAssertEqual(primary.label, "Bob")
        row.swipeLeft()
        XCTAssertEqual(primary.label, "Bob", "Scrolling must not select a participant")
    }

    @MainActor
    func testTapAfterScrollingSelectsTheVisibleParticipant() {
        let app = XCUIApplication()
        app.launch()
        let row = app.scrollViews["call.participant-row"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.swipeLeft()
        let frank = app.buttons["call.participant.Frank"]
        XCTAssertTrue(frank.waitForExistence(timeout: 5))
        frank.tap()
        XCTAssertEqual(app.staticTexts["call.primary-participant"].label, "Frank")
        XCTAssertFalse(app.buttons["call.participant.Frank"].exists, "The primary is excluded from the row")
    }

    @MainActor
    func testSpeakerAndMembershipChurnDuringGestures() {
        let app = XCUIApplication()
        app.launch()
        let row = app.scrollViews["call.participant-row"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        for mode in ["Speakers", "Departures"] {
            app.buttons[mode].tap()
            for _ in 0..<8 {
                let start = row.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
                let end = row.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5))
                start.press(forDuration: 0.3, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.3)
                row.swipeRight()
            }
            app.buttons["Stop"].tap()
            XCTAssertEqual(app.staticTexts["harness.status"].label, "Stopped; violations=0")
        }
    }
}
