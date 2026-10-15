import UIKit
import XCTest
@testable import MacroNative

@MainActor
final class ThreadComposerLifecycleTests: XCTestCase {
    func testMentionOverlayPreservesComposerHeightFocusAndHidesWithEditor() throws {
        let previous = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first(where: \.isKeyWindow)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        window.rootViewController = UIViewController(); window.makeKeyAndVisible()
        defer { window.isHidden = true; previous?.makeKeyAndVisible() }
        let view = ThreadComposerView()
        view.frame = CGRect(x: 12, y: 410, width: 378, height: 50)
        window.rootViewController!.view.addSubview(view)
        view.configure(plain: true, accessibilityID: "test-editor")
        view.setSendVisible(false); view.setWire("")
        view.layoutIfNeeded()
        let input = try XCTUnwrap(view.subviews.compactMap { $0 as? UITextView }.first)
        let choice = MentionCandidate(kind: .user, id: "macro|jamie@example.com", title: "Jamie Chen")
        view.candidates = { _ in [choice] }
        XCTAssertTrue(input.becomeFirstResponder())
        input.attributedText = MentionComposer.attributedText(from: "@jam")
        input.selectedRange = NSRange(location: 4, length: 0)
        var reported: [CGFloat] = []; view.onHeight = { reported.append($0) }
        view.textViewDidChange(input); view.layoutIfNeeded()
        let picker = try XCTUnwrap(window.subviews.compactMap { $0 as? MentionPickerView }.first)
        XCTAssertTrue(input.isFirstResponder)
        XCTAssertLessThanOrEqual(picker.frame.maxY, input.convert(input.bounds, to: window).minY - 7)
        XCTAssertFalse(view.subviews.contains(picker), "The menu must float outside the composer card")
        XCTAssertTrue(reported.allSatisfy { $0 <= 50 }, "Mention search must not expand the input card")
        view.frame.origin.y -= 60; view.setNeedsLayout(); view.layoutIfNeeded()
        XCTAssertEqual(picker.frame.maxY, input.convert(input.bounds, to: window).minY - 8, accuracy: 0.1)
        let table = try XCTUnwrap(picker.subviews.compactMap { $0 as? UITableView }.first)
        picker.tableView(table, didSelectRowAt: IndexPath(row: 0, section: 0))
        XCTAssertTrue(input.isFirstResponder, "Selection must retain the software keyboard")
        XCTAssertEqual(MentionComposer.wireContent(from: input.attributedText), choice.token.wire + " ")
        XCTAssertNil(picker.superview, "A completed mention closes its floating menu")
        input.attributedText = MentionComposer.attributedText(from: "@jam")
        input.selectedRange = NSRange(location: 4, length: 0); view.textViewDidChange(input)
        XCTAssertTrue(picker.superview === window)
        input.resignFirstResponder(); XCTAssertNil(picker.superview)
        input.becomeFirstResponder(); view.textViewDidChange(input)
        view.removeFromSuperview(); XCTAssertNil(picker.superview, "Leaving the screen must not strand an overlay")
    }

    func testUnchangedPlainComposerUpdatesDoNotInvalidateTextOrRepublishHeight() {
        let view = ThreadComposerView()
        view.frame = CGRect(x: 0, y: 0, width: 350, height: 200)
        view.configure(plain: true, accessibilityID: "agent-composer")
        view.setSendVisible(false)
        let mention = MentionCandidate(kind: .user, id: "macro|jamie@example.com", title: "Jamie Chen").token.wire
        let wire = "Ask " + mention + " about this draft"
        view.setWire(wire)
        view.setNeedsLayout(); view.layoutIfNeeded()
        view.setNeedsLayout(); view.layoutIfNeeded()
        let input = view.subviews.compactMap { $0 as? UITextView }.first!
        var edits = 0
        var heightReports = 0
        let observer = NotificationCenter.default.addObserver(forName: NSTextStorage.didProcessEditingNotification, object: input.textStorage, queue: .main) { _ in edits += 1 }
        defer { NotificationCenter.default.removeObserver(observer) }
        view.onHeight = { _ in heightReports += 1 }

        // SwiftUI can repeatedly update this representable during navigation/keyboard layout.
        for _ in 0..<100 {
            view.configure(plain: true, accessibilityID: "agent-composer")
            view.setSendVisible(false)
            view.setWire(wire)
            view.setNeedsLayout(); view.layoutIfNeeded()
        }
        XCTAssertEqual(edits, 0, "An unchanged representable must not dirty TextKit and restart hosting-view layout")
        XCTAssertEqual(heightReports, 0, "Stable layout must not continually enqueue SwiftUI state updates")
        XCTAssertEqual(MentionComposer.wireContent(from: input.attributedText), wire)
        let tokenFont = input.attributedText.attribute(.font, at: 4, effectiveRange: nil) as? UIFont
        XCTAssertTrue(tokenFont?.fontDescriptor.symbolicTraits.contains(.traitBold) == true, "Plain appearance must retain mention emphasis")
    }

    func testComposerMeasuresActualContentChangesAndSettlesAtItsHeightLimit() {
        let view = ThreadComposerView()
        view.frame = CGRect(x: 0, y: 0, width: 320, height: 240)
        view.configure(plain: true, accessibilityID: "agent-composer")
        view.setSendVisible(false); view.setWire("Short draft")
        view.setNeedsLayout(); view.layoutIfNeeded()
        let input = view.subviews.compactMap { $0 as? UITextView }.first!
        var heights: [CGFloat] = []
        view.onHeight = { heights.append($0) }
        let long = Array(repeating: "A longer draft with another line", count: 20).joined(separator: "\n")
        view.setWire(long); view.setNeedsLayout(); view.layoutIfNeeded()
        XCTAssertEqual(heights.last, 144)
        XCTAssertTrue(input.isScrollEnabled)
        let settledCount = heights.count
        for _ in 0..<30 { view.setWire(long); view.setNeedsLayout(); view.layoutIfNeeded() }
        XCTAssertEqual(heights.count, settledCount)
        view.setWire("Short again"); view.setNeedsLayout(); view.layoutIfNeeded()
        XCTAssertLessThan(heights.last ?? 144, 144)
        XCTAssertFalse(input.isScrollEnabled)
    }
}
