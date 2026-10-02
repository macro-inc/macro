import XCTest
import UIKit

/// Local, opt-in inspection of the signed-in native app; never runs in ordinary suites.
@MainActor
final class NativeVisualDriverUITests: XCTestCase {
    func testAuthorizedReferenceDriver() throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["MACRO_NATIVE_VISUAL_DRIVER"] == "1",
              let commandPath = environment["MACRO_NATIVE_VISUAL_COMMAND"] else { throw XCTSkip("Reference audit is opt-in") }
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.macro.app.native")
        app.activate()
        print("NATIVE_VISUAL_READY")
        let deadline = Date().addingTimeInterval(1800)
        while Date() < deadline {
            guard let data = FileManager.default.contents(atPath: commandPath),
                  let command = try? JSONSerialization.jsonObject(with: data) as? [String: String],
                  let action = command["action"] else { RunLoop.current.run(until: Date().addingTimeInterval(0.25)); continue }
            try? FileManager.default.removeItem(atPath: commandPath)
            let targetApp = command["app"].map { XCUIApplication(bundleIdentifier: $0) } ?? app
            let kind = command["kind"] ?? "button"
            let query: XCUIElementQuery = switch kind { case "textField": targetApp.textFields; case "secureTextField": targetApp.secureTextFields; case "textView": targetApp.textViews; case "staticText": targetApp.staticTexts; default: targetApp.buttons }
            let target = command["label"].map { query[$0] } ?? query.element(boundBy: Int(command["index"] ?? "0") ?? 0)
            switch action {
            case "snapshot":
                print("NATIVE_VISUAL_TREE\n" + targetApp.debugDescription)
                let shot = XCTAttachment(screenshot: targetApp.screenshot()); shot.name = command["name"] ?? "Tauri reference"; shot.lifetime = .keepAlways; add(shot)
            case "tap": if target.waitForExistence(timeout: 4) { target.tap() } else { print("NATIVE_VISUAL_TARGET_NOT_FOUND") }
            case "type":
                if target.waitForExistence(timeout: 4) { target.tap(); target.typeText(command["text"] ?? "") }
                else { print("NATIVE_VISUAL_TARGET_NOT_FOUND") }
            case "typeFile":
                guard let path = command["path"], let secret = try? String(contentsOfFile: path, encoding: .utf8) else { XCTFail("Missing supplied sign-in value"); return }
                target.tap(); target.typeText(secret.trimmingCharacters(in: .whitespacesAndNewlines))
                try? FileManager.default.removeItem(atPath: path)
            case "pasteFile":
                guard let path = command["path"], let secret = try? String(contentsOfFile: path, encoding: .utf8) else { XCTFail("Missing supplied sign-in value"); return }
                let saved = UIPasteboard.general.items
                UIPasteboard.general.string = secret.trimmingCharacters(in: .whitespacesAndNewlines)
                target.tap(); target.press(forDuration: 1)
                let paste = targetApp.menuItems["Paste"]
                XCTAssertTrue(paste.waitForExistence(timeout: 4)); paste.tap()
                UIPasteboard.general.items = saved; try? FileManager.default.removeItem(atPath: path)
            case "coordinate":
                let x = Double(command["x"] ?? "0") ?? 0; let y = Double(command["y"] ?? "0") ?? 0
                targetApp.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y)).tap()
            case "press", "swipe":
                let x = Double(command["x"] ?? "0") ?? 0; let y = Double(command["y"] ?? "0") ?? 0
                let start = targetApp.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx:x,dy:y))
                if action == "press" { start.press(forDuration: Double(command["duration"] ?? "0.8") ?? 0.8) }
                else {
                    let end = targetApp.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx:Double(command["x2"] ?? "0") ?? 0,dy:Double(command["y2"] ?? "0") ?? 0))
                    start.press(forDuration: 0.05, thenDragTo: end)
                }
            case "clearText": target.tap(); target.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 250))
            case "activate": targetApp.activate()
            case "done": print("NATIVE_VISUAL_DONE"); return
            default: XCTFail("Unknown reference action"); return
            }
            try? (command["id"] ?? action).write(toFile: commandPath + ".done", atomically: true, encoding: .utf8)
            print("NATIVE_VISUAL_ACTION_DONE " + action)
        }
        throw XCTSkip("Reference audit driver ended")
    }
}
