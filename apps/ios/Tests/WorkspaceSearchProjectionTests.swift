import XCTest
@testable import MacroNative

final class WorkspaceSearchProjectionTests: XCTestCase {
    func testFeaturedNameMatchesKeepAllChannelsAndAtMostThreeOtherEntities() {
        let cache = (0..<5).map { WorkspaceItem(id: "file-\($0)", kind: .document, title: "Plan \($0)", entityType: "document") }
            + (0..<4).map { WorkspaceItem(id: "channel-\($0)", kind: .channel, title: "Plan team \($0)", entityType: "channel") }
        let value = WorkspaceSearchProjection.project(query: "plan", cached: cache, service: [])
        XCTAssertEqual(value.featuredCount, 7)
        XCTAssertEqual(value.items.prefix(4).map(\.kind), Array(repeating: .channel, count: 4))
        XCTAssertEqual(value.items.filter { $0.kind == .document }.count, 3)
    }
    func testServicePayloadWinsWithoutLosingFeaturedOrderOrExactMessageTarget() {
        let local = WorkspaceItem(id: "channel", kind: .channel, title: "Engineers", entityType: "channel")
        let remote = WorkspaceItem(id: "channel", kind: .channel, title: "Engineers", entityType: "channel", payload: .object(["message_id": .string("actual-message")]))
        let other = WorkspaceItem(id: "other", kind: .email, title: "Subject", entityType: "email_thread")
        let value = WorkspaceSearchProjection.project(query: "engineers", cached: [local, local], service: [other, remote, other])
        XCTAssertEqual(value.items.map(\.id), ["channel", "other"])
        XCTAssertEqual(value.featuredCount, 1)
        XCTAssertEqual(NativeChannelRoute.target(for: value.items[0])?.messageID, "actual-message")
    }
    func testNameOnlyLocalMatchingAndEmptyQueryDoNotInventFeaturedRows() {
        let local = WorkspaceItem(id: "doc", kind: .document, title: "Café design", subtitle: "unrelated title", entityType: "document")
        XCTAssertEqual(WorkspaceSearchProjection.project(query: "cafe", cached: [local], service: []).items.map(\.id), ["doc"])
        XCTAssertTrue(WorkspaceSearchProjection.project(query: "unrelated", cached: [local], service: []).items.isEmpty)
        let empty = WorkspaceSearchProjection.project(query: "", cached: [local], service: [local])
        XCTAssertEqual(empty.featuredCount, 0); XCTAssertEqual(empty.items, [local])
    }
}
