import Foundation

/// Only routing metadata is persisted; notification bodies and images stay in APNs.
public struct PendingPush: Codable, Equatable {
    public let type: String
    public let payload: [String: String]
    public let deliveryId: String
    public let receivedAtMs: Int64

    public init(type: String, payload: [String: String], deliveryId: String, receivedAtMs: Int64) {
        self.type = type
        self.payload = payload
        self.deliveryId = deliveryId
        self.receivedAtMs = receivedAtMs
    }
}

/// Confine this store to the main thread. A successful write precedes delivery to JS.
public final class PendingPushStore {
    private struct Receipt: Codable {
        let sourceId: String
        let receivedAtMs: Int64
    }

    private struct State: Codable {
        var pending: PendingPush?
        var receipts: [Receipt] = []
        var recipientId: String?
    }

    private let fileURL: URL
    private let lifetimeMs: Int64
    private var state: State

    public init(fileURL: URL, lifetimeMs: Int64 = 24 * 60 * 60 * 1000) throws {
        self.fileURL = fileURL
        self.lifetimeMs = lifetimeMs
        if FileManager.default.fileExists(atPath: fileURL.path) {
            let data = try Data(contentsOf: fileURL)
            // Unreadable navigation state must not disable all future taps.
            // I/O errors still propagate; only an invalid persisted record is
            // discarded and replaced by the next atomic capture.
            state = (try? JSONDecoder().decode(State.self, from: data)) ?? State()
        } else {
            state = State()
        }
    }

    /// Repeated native callbacks never replace a newer explicit user intent.
    public func capture(sourceId: String, event: PendingPush) throws -> PendingPush? {
        var next = pruned(at: event.receivedAtMs)
        if next.receipts.contains(where: { $0.sourceId == sourceId }) {
            return nil
        }
        next.pending = event
        next.receipts.append(Receipt(sourceId: sourceId, receivedAtMs: event.receivedAtMs))
        next.receipts = Array(next.receipts.suffix(32))
        try save(next)
        return event
    }

    /// Reading or sending an event never consumes it; a reload may retry it.
    public func pending(at nowMs: Int64) throws -> PendingPush? {
        let next = pruned(at: nowMs)
        if next.pending != state.pending || next.receipts.count != state.receipts.count {
            try save(next)
        }
        return next.pending
    }

    /// A late acknowledgment for A cannot clear a more recent tap B.
    @discardableResult
    public func acknowledge(deliveryId: String) throws -> Bool {
        guard state.pending?.deliveryId == deliveryId else { return false }
        var next = state
        next.pending = nil
        try save(next)
        return true
    }

    public func clear() throws {
        var next = state
        next.pending = nil
        try save(next)
    }

    private func pruned(at nowMs: Int64) -> State {
        var next = state
        if let pending = next.pending, !isFresh(pending.receivedAtMs, nowMs: nowMs) {
            next.pending = nil
        }
        next.receipts.removeAll { !isFresh($0.receivedAtMs, nowMs: nowMs) }
        return next
    }

    /// Account changes discard legacy/unmatched intents; a tap explicitly
    /// addressed to the newly authenticated account survives login bootstrap.
    public func configureRecipient(_ recipientId: String?) throws {
        var next = state
        if recipientId == nil || (next.recipientId != recipientId && next.pending?.payload["recipientId"] != recipientId) {
            next.pending = nil
        }
        next.recipientId = recipientId
        try save(next)
    }

    private func isFresh(_ receivedAtMs: Int64, nowMs: Int64) -> Bool {
        // A clock jump into the past must not retain an intent indefinitely.
        receivedAtMs <= nowMs && nowMs - receivedAtMs < lifetimeMs
    }

    private func save(_ next: State) throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try JSONEncoder().encode(next).write(to: fileURL, options: .atomic)
        state = next
    }
}
