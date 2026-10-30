import Foundation
import XCTest
@testable import PendingPushStore

final class PendingPushStoreTests: XCTestCase {
    private var directory: URL!
    private var fileURL: URL { directory.appendingPathComponent("pending.json") }

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDownWithError() throws {
        if FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.removeItem(at: directory)
        }
    }

    func testPendingTapSurvivesStoreRecreationAndRepeatedReadsUntilAcknowledgment() throws {
        let event = PendingPush(type: "BACKGROUND_TAP", payload: ["notificationId": "notification-a"], deliveryId: "delivery-a", receivedAtMs: 100)
        let store = try PendingPushStore(fileURL: fileURL)
        XCTAssertEqual(try store.capture(sourceId: "apns-a", event: event), event)
        XCTAssertEqual(try store.pending(at: 101), event)
        let reloaded = try PendingPushStore(fileURL: fileURL)
        XCTAssertEqual(try reloaded.pending(at: 102), event)
        XCTAssertEqual(try reloaded.pending(at: 103), event)
        XCTAssertTrue(try reloaded.acknowledge(deliveryId: "delivery-a"))
        XCTAssertNil(try PendingPushStore(fileURL: fileURL).pending(at: 104))
        XCTAssertNil(try reloaded.capture(sourceId: "apns-a", event: event))
    }

    func testLatestTapWinsAndOldAcknowledgmentOrRedeliveryCannotClearIt() throws {
        let first = PendingPush(type: "BACKGROUND_TAP", payload: ["notificationId": "a"], deliveryId: "first", receivedAtMs: 100)
        let second = PendingPush(type: "FOREGROUND_TAP", payload: ["notificationId": "b"], deliveryId: "second", receivedAtMs: 101)
        let store = try PendingPushStore(fileURL: fileURL)
        _ = try store.capture(sourceId: "apns-a", event: first)
        _ = try store.capture(sourceId: "apns-b", event: second)
        XCTAssertFalse(try store.acknowledge(deliveryId: "first"))
        let duplicate = PendingPush(type: first.type, payload: first.payload, deliveryId: "duplicate", receivedAtMs: 102)
        XCTAssertNil(try store.capture(sourceId: "apns-a", event: duplicate))
        XCTAssertEqual(try store.pending(at: 103), second)
    }

    func testExpiredIntentAndClockRollbackDoNotReopenAnOldConversation() throws {
        let event = PendingPush(type: "BACKGROUND_TAP", payload: ["notificationId": "a"], deliveryId: "first", receivedAtMs: 100)
        let store = try PendingPushStore(fileURL: fileURL, lifetimeMs: 10)
        _ = try store.capture(sourceId: "apns-a", event: event)
        XCTAssertNil(try store.pending(at: 110))
        _ = try store.capture(sourceId: "apns-a", event: event)
        XCTAssertNil(try store.pending(at: 99))
    }

    func testAccountClearPersistsAndDoesNotAllowNativeRedeliveryToReopenIt() throws {
        let event = PendingPush(type: "BACKGROUND_TAP", payload: ["recipientId": "old-account"], deliveryId: "first", receivedAtMs: 100)
        let store = try PendingPushStore(fileURL: fileURL)
        _ = try store.capture(sourceId: "apns-a", event: event)
        try store.clear()
        let reloaded = try PendingPushStore(fileURL: fileURL)
        XCTAssertNil(try reloaded.pending(at: 101))
        XCTAssertNil(try reloaded.capture(sourceId: "apns-a", event: event))
    }

    func testFailedPersistenceDoesNotConsumePreviousIntent() throws {
        let event = PendingPush(type: "BACKGROUND_TAP", payload: ["notificationId": "a"], deliveryId: "first", receivedAtMs: 100)
        let store = try PendingPushStore(fileURL: fileURL)
        _ = try store.capture(sourceId: "apns-a", event: event)
        try FileManager.default.removeItem(at: fileURL)
        try FileManager.default.createDirectory(at: fileURL, withIntermediateDirectories: true)
        XCTAssertThrowsError(try store.acknowledge(deliveryId: "first"))
        XCTAssertEqual(try store.pending(at: 101), event)
    }

    func testAccountConfigurationPreservesMatchingLaunchAndClearsOnSwitchOrLogout() throws {
        let event = PendingPush(type: "BACKGROUND_TAP", payload: ["recipientId": "account-a"], deliveryId: "first", receivedAtMs: 100)
        let store = try PendingPushStore(fileURL: fileURL)
        _ = try store.capture(sourceId: "apns-a", event: event)
        try store.configureRecipient("account-a")
        XCTAssertEqual(try store.pending(at: 101), event)
        try store.configureRecipient("account-b")
        XCTAssertNil(try store.pending(at: 102))
        _ = try store.capture(sourceId: "apns-b", event: event)
        try store.configureRecipient(nil)
        XCTAssertNil(try store.pending(at: 103))
    }

    func testMalformedPersistedStateDoesNotDisableFutureTaps() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("invalid json".utf8).write(to: fileURL)
        let store = try PendingPushStore(fileURL: fileURL)
        XCTAssertNil(try store.pending(at: 100))
        let event = PendingPush(type: "BACKGROUND_TAP", payload: ["notificationId": "a"], deliveryId: "first", receivedAtMs: 100)
        _ = try store.capture(sourceId: "apns-a", event: event)
        XCTAssertEqual(try PendingPushStore(fileURL: fileURL).pending(at: 101), event)
    }
}
