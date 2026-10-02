import XCTest

@MainActor
final class ChromeUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    func testFloatingNewMenuAndDockMatchMobileHierarchy() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "--workspace-testing"]; app.launch()
        XCTAssertTrue(app.buttons["workspace-create"].waitForExistence(timeout: 5))
        let createFrame = app.buttons["workspace-create"].frame
        app.buttons["workspace-create"].tap()
        let choices = ["email", "channels", "files", "calendar", "tasks", "more"].map { app.buttons["create-menu-\($0)"] }
        XCTAssertTrue(choices.last!.waitForExistence(timeout: 3))
        attach(app, "Floating New menu before geometry assertions")
        let capturedCloseFrame = app.buttons["Close create menu"].frame
        print("New geometry trigger \(createFrame), close \(capturedCloseFrame), choices \(choices.map(\.frame))")
        for choice in choices { XCTAssertTrue(choice.waitForExistence(timeout: 2)); XCTAssertTrue(choice.isHittable); XCTAssertEqual(choice.frame.maxX, createFrame.maxX, accuracy: 1) }
        for index in 1..<choices.count { XCTAssertEqual(choices[index].frame.minY - choices[index - 1].frame.maxY, 8.5, accuracy: 1) }
        let closeFrame = app.buttons["Close create menu"].frame
        XCTAssertEqual(closeFrame.maxX, createFrame.maxX, accuracy: 1)
        XCTAssertEqual(closeFrame.maxY, createFrame.maxY, accuracy: 1)
        XCTAssertEqual(closeFrame.width, createFrame.width, accuracy: 1)
        attach(app, "Floating New menu")
        app.buttons["Close create menu"].tap()
        app.buttons["dock-files"].tap()
        XCTAssertTrue(app.buttons["pill-myFiles"].waitForExistence(timeout: 4)); app.buttons["pill-myFiles"].tap()
        XCTAssertTrue(app.buttons["workspace-item-workspace-design"].waitForExistence(timeout: 4))
        let dock = app.buttons["dock-files"]
        XCTAssertEqual(dock.frame.height, 46, accuracy: 1)
        XCTAssertEqual(app.frame.maxY - dock.frame.maxY, 28, accuracy: 1, "Dock matches Tauri’s fixed28pt bottom gutter")
        XCTAssertEqual(app.buttons["dock-search"].frame.height, 46, accuracy: 1)
        XCTAssertLessThan(app.buttons["workspace-create"].frame.maxY, dock.frame.minY)
        attach(app, "Files with floating original-icon dock")
        app.buttons["dock-more"].tap()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["CRM"].isHittable)
        XCTAssertTrue(app.buttons["Calls"].isHittable)
        XCTAssertTrue(app.buttons["Tasks"].isHittable)
        XCTAssertEqual(app.buttons["Settings"].frame.height, 46.75, accuracy: 1)
        XCTAssertEqual(app.buttons["Calls"].frame.minY - app.buttons["CRM"].frame.maxY, 4.25, accuracy: 1)
        attach(app, "More views drawer")
    }
    func testDockSelectionMovesBetweenTabsWithoutChangingGeometry() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "--workspace-testing"]; app.launch()
        let home = app.buttons["dock-home"], files = app.buttons["dock-files"]
        XCTAssertTrue(home.waitForExistence(timeout: 5)); XCTAssertTrue(home.isSelected)
        let frame = files.frame
        files.tap(); XCTAssertTrue(app.buttons["pill-myFiles"].waitForExistence(timeout: 4))
        XCTAssertTrue(files.isSelected); XCTAssertFalse(home.isSelected)
        assertSameFrame(files.frame, frame)
        attach(app, "Native moving glass dock selection on Files")
        home.tap(); XCTAssertTrue(app.buttons["pill-signal"].waitForExistence(timeout: 4))
        XCTAssertTrue(home.isSelected); XCTAssertFalse(files.isSelected)
        assertSameFrame(files.frame, frame)
        attach(app, "Native moving glass dock selection returns Home")
    }
    private func assertSameFrame(_ actual: CGRect, _ expected: CGRect) {
        XCTAssertEqual(actual.minX, expected.minX, accuracy: 0.001)
        XCTAssertEqual(actual.minY, expected.minY, accuracy: 0.001)
        XCTAssertEqual(actual.width, expected.width, accuracy: 0.001)
        XCTAssertEqual(actual.height, expected.height, accuracy: 0.001)
    }
    private func attach(_ app: XCUIApplication, _ name: String) {
        let value = XCTAttachment(screenshot: app.screenshot()); value.name = name; value.lifetime = .keepAlways; add(value)
    }
}
