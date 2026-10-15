import UIKit
import XCTest
@testable import MacroNative

@MainActor
final class MentionComposerTests: XCTestCase {
    private let person = MentionCandidate(kind: .user, id: "macro|jamie@macro.local", title: "Jamie Chen", subtitle: "jamie@macro.local")

    func testLinkAndAgentChipsPreserveExactDraftWire() {
        let wire = #"<m-link>{"url":"https://macro.com/app","text":"Macro link"}</m-link> <m-agent-session-mention>{"id":"agent-1","label":"Fix the composer"}</m-agent-session-mention>"#
        let attributed = MentionComposer.attributedText(from: wire)
        XCTAssertEqual(attributed.string, "Macro link Fix the composer")
        XCTAssertEqual(MentionComposer.wireContent(from: attributed), wire)
        XCTAssertEqual(MentionCodec.mentions(in: wire).map(\.entityType), ["agent_session"])
    }

    func testSavedReplyTargetWireSurvivesEditingAnotherMention() {
        let quote = #"<m-reply-target>{"channelId":"channel","targetMessageId":"reply","targetThreadId":"root","displayText":"Quoted message","senderId":"macro|jamie@macro.local"}</m-reply-target>"#
        let wire = quote + "\n\nAsk " + person.token.wire
        XCTAssertEqual(MentionComposer.wireContent(from: MentionComposer.attributedText(from: wire)), wire)
    }

    func testCompactPickerFitsAnIntegerNumberOfRowsWithoutCategoryHeaders() {
        let picker = MentionPickerView()
        let choices = (0..<20).map { MentionCandidate(kind: .document, id: "file-\($0)", title: "File \($0)") }
        picker.update(candidates: choices, query: "")
        picker.frame = CGRect(x: 0, y: 0, width: 360, height: picker.intrinsicContentSize.height)
        picker.layoutIfNeeded()
        let table = picker.subviews.compactMap { $0 as? UITableView }.first!
        XCTAssertEqual(table.numberOfSections, 1)
        XCTAssertEqual(table.numberOfRows(inSection: 0), 20)
        XCTAssertEqual(table.bounds.height.truncatingRemainder(dividingBy: table.rowHeight), 0, accuracy: 0.01)
        let clamped = picker.fittingHeight(maximum: 217)
        XCTAssertLessThanOrEqual(clamped, 217)
        XCTAssertEqual((clamped - 14).truncatingRemainder(dividingBy: table.rowHeight), 0, accuracy: 0.01, "A menu near the top safe area must not clip its last row")
        XCTAssertEqual(picker.fittingHeight(maximum: 30), 0)
    }

    func testDraftRoundTripPreservesOriginalWireAndUnicode() {
        let wire = "👩🏽‍💻 Talk to \(person.token.wire)\nTomorrow"
        let attributed = MentionComposer.attributedText(from: wire)
        XCTAssertEqual(attributed.string, "👩🏽‍💻 Talk to @Jamie Chen\nTomorrow")
        XCTAssertEqual(MentionComposer.wireContent(from: attributed), wire)
    }

    func testAdjacentMentionsOfTheSamePersonKeepBothTokens() {
        let wire = person.token.wire + person.token.wire
        let attributed = MentionComposer.attributedText(from: wire)
        XCTAssertEqual(attributed.string, "@Jamie Chen@Jamie Chen")
        XCTAssertEqual(MentionComposer.wireContent(from: attributed), wire)
    }

    func testMentionTriggerUsesUTF16AndDoesNotTriggerInsideEmailOrExistingToken() {
        let text = NSAttributedString(string: "👩🏽‍💻 Hi @jam")
        let query = MentionComposer.activeQuery(in: text, selection: NSRange(location: text.length, length: 0))
        XCTAssertEqual(query?.query, "jam")
        XCTAssertEqual(query?.range, NSRange(location: ("👩🏽‍💻 Hi " as NSString).length, length: 4))
        let email = NSAttributedString(string: "jamie@macro")
        XCTAssertNil(MentionComposer.activeQuery(in: email, selection: NSRange(location: email.length, length: 0)))
        let token = MentionComposer.attributedText(from: person.token.wire)
        XCTAssertNil(MentionComposer.activeQuery(in: token, selection: NSRange(location: token.length, length: 0)))
    }

    func testSelectionInsertsARealMentionAndMovesCaretAfterSpace() {
        let input = UITextView()
        input.attributedText = NSAttributedString(string: "Hi @jam", attributes: MentionComposer.typingAttributes)
        input.selectedRange = NSRange(location: input.attributedText.length, length: 0)
        let query = MentionComposer.activeQuery(in: input.attributedText, selection: input.selectedRange)!
        MentionComposer.insert(person, replacing: query, in: input)
        XCTAssertEqual(input.text, "Hi @Jamie Chen ")
        XCTAssertEqual(input.selectedRange.location, ("Hi @Jamie Chen " as NSString).length)
        XCTAssertEqual(MentionComposer.wireContent(from: input.attributedText), "Hi \(person.token.wire) ")
        XCTAssertNil(input.typingAttributes[.macroMention])
        XCTAssertNil(MentionComposer.activeQuery(in: input.attributedText, selection: input.selectedRange), "A selected mention followed by a space must not reopen the picker")
    }

    func testBackspacingAnyPartOfATokenRemovesTheWholeTokenWithoutDamagingEmoji() {
        let input = UITextView()
        input.attributedText = MentionComposer.attributedText(from: "👩🏽‍💻 " + person.token.wire)
        let range = NSRange(location: input.attributedText.length - 1, length: 1)
        XCTAssertFalse(MentionComposer.shouldChange(input, range: range, replacement: ""))
        XCTAssertEqual(input.text, "👩🏽‍💻 ")
        XCTAssertEqual(MentionCodec.mentions(in: MentionComposer.wireContent(from: input.attributedText)).count, 0)
    }

    func testEditingInsideATokenRemovesItsNotificationTarget() {
        let input = UITextView()
        input.attributedText = MentionComposer.attributedText(from: person.token.wire)
        XCTAssertTrue(MentionComposer.shouldChange(input, range: NSRange(location: 3, length: 0), replacement: "x"))
        input.textStorage.replaceCharacters(in: NSRange(location: 3, length: 0), with: "x")
        MentionComposer.normalize(input)
        XCTAssertEqual(input.text, "@Jaxmie Chen")
        XCTAssertTrue(MentionCodec.mentions(in: MentionComposer.wireContent(from: input.attributedText)).isEmpty)
    }
}
