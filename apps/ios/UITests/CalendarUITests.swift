import XCTest

@MainActor
final class CalendarUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testCalendarDateViewsAndSourceFiltersAreNative() {
        let app = launchCalendar()
        XCTAssertTrue(app.buttons["calendar-new-call"].exists)
        XCTAssertTrue(app.buttons["calendar-event-demo-calendar-0"].waitForExistence(timeout: 5))
        let firstEvent = app.buttons["calendar-event-demo-calendar-0"]
        XCTAssertLessThan(firstEvent.frame.minY, app.frame.height * 0.6, "The compact day header must leave space for the time grid")
        attach(app, "Native day time grid")
        setPeriod("week", app: app)
        attach(app, "Native week time grid")
        for _ in 0..<7 where !app.buttons["calendar-event-demo-calendar-0"].exists { app.swipeUp() }
        XCTAssertTrue(app.buttons["calendar-event-demo-calendar-0"].waitForExistence(timeout: 5))
        setPeriod("month", app: app)
        attach(app, "Native month event grid")
        setPeriod("day", app: app)
        app.scrollViews["calendar-time-grid"].swipeLeft()
        XCTAssertFalse(app.buttons["calendar-event-demo-calendar-0"].exists)
        XCTAssertFalse(app.buttons["calendar-details-close"].exists, "Swiping dates must not activate the event under the gesture")
        app.buttons["calendar-today"].tap()
        XCTAssertTrue(app.buttons["calendar-event-demo-calendar-0"].waitForExistence(timeout: 5))
        app.buttons["calendar-filter"].tap()
        let account = app.buttons["calendar-account-alex@macro.local"]
        XCTAssertTrue(account.waitForExistence(timeout: 3)); account.tap()
        XCTAssertEqual(account.value as? String, "Hidden")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
        waitFor(NSPredicate(format: "exists == false"), element: app.buttons["calendar-event-demo-calendar-0"])
        XCTAssertFalse(app.buttons["calendar-event-demo-calendar-2"].exists)
        attach(app, "Native linked calendar filtering")
    }

    func testCalendarSettingsMatchProductionGroupsAndKeepSelections() {
        let app = launchCalendar()
        app.buttons["calendar-filter"].tap()
        XCTAssertTrue(app.buttons["calendar-period-day"].waitForExistence(timeout: 4))
        XCTAssertEqual(app.navigationBars.count, 0)
        XCTAssertFalse(app.buttons["Done"].exists)
        let monday = app.buttons["Monday"]
        for _ in 0..<3 where !monday.isHittable { app.swipeUp() }
        monday.tap(); XCTAssertTrue(monday.isSelected)
        let time = app.buttons["24-hour"]
        for _ in 0..<3 where !time.isHittable { app.swipeUp() }
        time.tap(); XCTAssertTrue(time.isSelected)
        attach(app, "Calendar production settings groups")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).tap()
        XCTAssertTrue(app.buttons["calendar-filter"].isHittable)
    }

    func testEventDetailsUseFloatingActionsAndGuestRows() {
        let app = launchCalendar()
        let event = app.buttons["calendar-event-demo-calendar-0"]
        XCTAssertTrue(event.waitForExistence(timeout: 5)); event.tap()
        let close = app.buttons["calendar-details-close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        XCTAssertEqual(app.navigationBars.count, 0)
        XCTAssertEqual(close.frame.height, 46.75, accuracy: 1)
        XCTAssertTrue(app.buttons["calendar-copy"].exists)
        XCTAssertTrue(app.buttons["calendar-edit"].exists)
        XCTAssertTrue(app.buttons["calendar-delete"].exists)
        XCTAssertTrue(app.buttons["calendar-attendees"].exists)
        let rsvp = app.buttons["calendar-rsvp-accepted"]
        for _ in 0..<3 where !rsvp.isHittable { app.swipeUp() }
        XCTAssertTrue(rsvp.isHittable)
        XCTAssertLessThan(rsvp.frame.maxY, app.frame.maxY - 8)
        attach(app, "Calendar event floating glass drawer")
        close.tap()
        XCTAssertTrue(app.buttons["calendar-filter"].waitForExistence(timeout: 4))
    }

    func testCreateEditAndDeleteCalendarEventInIsolatedPreview() {
        let app = launchCalendar()
        let create = app.buttons["workspace-create"]
        XCTAssertLessThanOrEqual(create.frame.maxY, app.buttons["dock-calendar"].frame.minY)
        create.tap()
        let title = app.descendants(matching: .any).matching(identifier: "calendar-event-title").firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 3))
        title.tap(); title.typeText("Native calendar flow")
        app.buttons["calendar-location-pill"].tap()
        let location = app.descendants(matching: .any).matching(identifier: "calendar-location").firstMatch
        location.tap(); location.typeText("Macro studio")
        app.buttons["Save location"].tap()
        XCTAssertEqual(app.navigationBars.count, 0)
        XCTAssertFalse(app.buttons["Done"].exists)
        attach(app, "Native event editor")
        app.buttons["calendar-save"].tap()
        waitFor(NSPredicate(format: "exists == false"), element: app.buttons["calendar-save"])
        setPeriod("month", app: app)
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Native calendar flow,")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 3))
        for _ in 0..<3 where row.frame.maxY > app.buttons["workspace-create"].frame.minY {
            app.scrollViews["calendar-month-grid"].swipeUp()
        }
        XCTAssertLessThanOrEqual(row.frame.maxY, app.buttons["workspace-create"].frame.minY, "Calendar events must scroll clear of the floating actions")
        row.tap()
        XCTAssertTrue(app.buttons["calendar-edit"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Macro studio"].exists)
        attach(app, "Native event details")
        app.buttons["calendar-edit"].tap()
        XCTAssertTrue(title.waitForExistence(timeout: 3))
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        title.typeText(" updated")
        app.buttons["calendar-save"].tap()
        XCTAssertTrue(app.staticTexts["Native calendar flow updated"].waitForExistence(timeout: 3))
        let delete = app.buttons["calendar-delete"]
        for _ in 0..<5 where !delete.isHittable { app.swipeUp() }
        delete.tap()
        app.sheets.buttons["Delete event"].tap()
        XCTAssertTrue(app.buttons["calendar-filter"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Native calendar flow updated,")).firstMatch.exists)
    }

    private func setPeriod(_ period: String, app: XCUIApplication) {
        app.buttons["calendar-filter"].tap()
        let choice = app.buttons["calendar-period-\(period)"]
        XCTAssertTrue(choice.waitForExistence(timeout: 3)); choice.tap()
    }

    private func launchCalendar() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--workspace-testing"]
        app.launch()
        let calendar = app.buttons["dock-calendar"]
        XCTAssertTrue(calendar.waitForExistence(timeout: 10))
        calendar.tap()
        XCTAssertTrue(app.buttons["calendar-filter"].waitForExistence(timeout: 5))
        return app
    }
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func waitFor(_ predicate: NSPredicate, element: XCUIElement) {
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 5), .completed)
    }
}
