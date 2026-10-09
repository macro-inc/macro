import XCTest
@testable import CallOverlayHarness

@MainActor
final class ParticipantStripTests: XCTestCase {
    private func items(_ ids: [String]) -> [ParticipantStripScrollView.Item] {
        ids.enumerated().map { index, id in
            .init(id: id, frame: CGRect(x: index * 138, y: 0, width: 128, height: 92))
        }
    }

    func testHitTargetSurvivesParticipantRemovalAndReplacement() {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 200))
        let row = ParticipantStripScrollView(frame: CGRect(x: 0, y: 0, width: 200, height: 92))
        window.addSubview(row)
        let tile = UIView(frame: row.bounds)
        row.addSubview(tile)
        XCTAssertTrue(row.hitTest(CGPoint(x: 20, y: 20), with: nil) === row)
        tile.removeFromSuperview()
        row.addSubview(UIView(frame: row.bounds))
        XCTAssertTrue(row.hitTest(CGPoint(x: 20, y: 20), with: nil) === row)
        XCTAssertNil(row.hitTest(CGPoint(x: -1, y: 20), with: nil))
    }

    func testSpeakerSwapPreservesSurvivingVisibleParticipantPosition() {
        let row = ParticipantStripScrollView(frame: CGRect(x: 0, y: 0, width: 200, height: 92))
        row.updateItems(items(["Bob", "Carol", "Dave", "Eve"]), contentSize: CGSize(width: 542, height: 92))
        row.contentOffset.x = 150
        // Alice was primary. Now Bob is primary and Alice enters before Carol.
        row.updateItems(items(["Alice", "Carol", "Dave", "Eve"]), contentSize: CGSize(width: 542, height: 92))
        XCTAssertEqual(row.contentOffset.x, 150)
        // Alice leaves: Carol keeps the same on-screen position.
        row.updateItems(items(["Carol", "Dave", "Eve"]), contentSize: CGSize(width: 404, height: 92))
        XCTAssertEqual(row.contentOffset.x, 12)
    }

    func testEmptyRowAndContentShrinkClampOffset() {
        let row = ParticipantStripScrollView(frame: CGRect(x: 0, y: 0, width: 200, height: 92))
        row.updateItems(items(["Bob", "Carol", "Dave"]), contentSize: CGSize(width: 404, height: 92))
        row.contentOffset.x = 204
        row.updateItems(items(["Bob"]), contentSize: CGSize(width: 128, height: 92))
        XCTAssertEqual(row.contentOffset.x, 0)
        row.updateItems([], contentSize: CGSize(width: 0, height: 92))
        XCTAssertEqual(row.contentOffset.x, 0)
        XCTAssertFalse(row.isHidden)
    }

    func testSelectionUsesDisplayedFramesAndIgnoresGaps() {
        let row = ParticipantStripScrollView(frame: CGRect(x: 0, y: 0, width: 200, height: 92))
        row.updateItems(items(["Bob", "Carol"]), contentSize: CGSize(width: 266, height: 92))
        XCTAssertEqual(row.participant(at: CGPoint(x: 150, y: 20)), "Carol")
        XCTAssertNil(row.participant(at: CGPoint(x: 133, y: 20)))
    }
}
