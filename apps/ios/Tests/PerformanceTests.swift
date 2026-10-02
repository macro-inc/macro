import Foundation
import XCTest
@testable import MacroNative

/// Latency budgets cover native state work; network and view rendering are measured separately.
/// Fixture creation is excluded. These deliberately run in the ordinary Debug test configuration.
@MainActor
final class PerformanceTests: XCTestCase {
    private let channelID = "performance-channel"
    private let userID = "macro|performance@example.test"

    func testThousandMessageHistoryOpensAndReopensWithinInteractiveBudgets() async {
        let service = makeService(historyCount: 1_000)
        let store = ChatStore(api: service, userID: userID)
        await store.refreshChannels()
        let coldStart = DispatchTime.now().uptimeNanoseconds
        await store.open(service.channel)
        let coldMilliseconds = milliseconds(since: coldStart)

        XCTAssertEqual(store.messages[channelID]?.count, 1_000)
        XCTAssertEqual(store.messages[channelID]?.first?.id, service.history.first?.id)
        XCTAssertEqual(store.messages[channelID]?.last?.id, service.history.last?.id)
        XCTAssertEqual(store.selectedChannelID, channelID)
        record("cold_open_1000", samples: [coldMilliseconds], budget: "250 ms initial-history processing")
        XCTAssertLessThan(coldMilliseconds, 250, "Opening a large loaded history must remain responsive.")

        var warmSamples: [Double] = []
        for _ in 0..<12 {
            store.close(channelID)
            let start = DispatchTime.now().uptimeNanoseconds
            await store.open(service.channel)
            warmSamples.append(milliseconds(since: start))
        }
        record("warm_reopen_1000", samples: warmSamples, budget: "p95 33 ms; maximum 100 ms")
        XCTAssertLessThan(percentile95(warmSamples), 33, "Reopening a loaded channel should use at most two 60 Hz frames of model work.")
        XCTAssertLessThan(warmSamples.max() ?? .infinity, 100, "A reopen must not create a visible main-thread stall.")
        XCTAssertEqual(store.messages[channelID]?.count, 1_000)
        await store.shutDown()
    }

    func testOptimisticSendingWithLargeHistoryFitsWithinOneFrame() async throws {
        let service = makeService(historyCount: 1_000)
        let store = ChatStore(api: service, userID: userID)
        await store.refreshChannels()
        await store.open(service.channel)
        var samples: [Double] = []
        var sentIDs: [String] = []

        for index in 0..<20 {
            let content = "Fast message \(index)"
            store.setDraft(content, channelID: channelID)
            let start = DispatchTime.now().uptimeNanoseconds
            let id = store.send(content, channelID: channelID)
            samples.append(milliseconds(since: start))
            let sentID = try XCTUnwrap(id)
            sentIDs.append(sentID)
            XCTAssertEqual(store.messages[channelID]?.last?.id, sentID)
            XCTAssertEqual(store.pending[sentID], .sending)
            XCTAssertEqual(store.drafts[channelID], "")
        }

        record("optimistic_send_1000", samples: samples, budget: "p95 8 ms; maximum 16 ms")
        XCTAssertLessThan(percentile95(samples), 8, "Inserting a sent message must leave time in the frame for keyboard and row rendering.")
        XCTAssertLessThan(samples.max() ?? .infinity, 16, "Send must update the composer and message list within one 60 Hz frame.")
        XCTAssertEqual(Set(sentIDs).count, 20)
        XCTAssertEqual(store.messages[channelID]?.count, 1_020)
        XCTAssertEqual(service.sendCalls, 0, "All optimistic results must be visible before the suspended network work starts.")
        await store.shutDown()
    }

    func testReceiveBurstWithLargeHistoryLeavesTimeForRendering() async {
        let service = makeService(historyCount: 1_000)
        let store = ChatStore(api: service, userID: userID)
        await store.refreshChannels()
        await store.open(service.channel)
        let incoming = makeMessages(count: 100, startIndex: 1_000, baseDate: service.baseDate)
        var samples: [Double] = []
        let burstStart = DispatchTime.now().uptimeNanoseconds

        for message in incoming {
            let start = DispatchTime.now().uptimeNanoseconds
            store.receive(MessageEvent(parent: message.parent, actor: message.senderID,
                change: MessageChange(type: "posted", message: message)))
            samples.append(milliseconds(since: start))
        }
        let total = milliseconds(since: burstStart)

        record("receive_event_with_1000", samples: samples, budget: "p95 16 ms; maximum 50 ms; 100-event burst 1,000 ms")
        record("receive_burst_100", samples: [total], budget: "1,000 ms for 100 events")
        XCTAssertLessThan(percentile95(samples), 16, "Ordinary incoming messages must leave the keyboard responsive.")
        XCTAssertLessThan(samples.max() ?? .infinity, 50, "An individual event must not visibly stall scrolling.")
        XCTAssertLessThan(total, 1_000, "A reconnect burst must catch up promptly.")
        XCTAssertEqual(store.messages[channelID]?.count, 1_100)
        XCTAssertEqual(store.messages[channelID]?.last?.id, incoming.last?.id)
        XCTAssertEqual(store.channels.first?.preview, incoming.last?.content)
        await store.shutDown()
    }

    private func makeService(historyCount: Int) -> LatencyMessagingService {
        // A fresh date range prevents another test's date cache from hiding cold-load cost.
        let baseDate = Date(timeIntervalSince1970: 1_600_000_000 + Double(UInt32.random(in: 0..<100_000_000)))
        let history = makeMessages(count: historyCount, startIndex: 0, baseDate: baseDate)
        return LatencyMessagingService(channel: Channel(id: channelID, name: "Performance conversation"),
                                       history: history, baseDate: baseDate)
    }

    private func makeMessages(count: Int, startIndex: Int, baseDate: Date) -> [ChatMessage] {
        (startIndex..<(startIndex + count)).map { index in
            let date = MessageDate.string(baseDate.addingTimeInterval(Double(index)))
            return ChatMessage(id: String(format: "message-%05d", index), parent: MessageParent(id: channelID),
                senderID: userID, content: "Message \(index): a normal conversation with some longer text to read.",
                createdAt: date, updatedAt: date)
        }
    }

    private func milliseconds(since start: UInt64) -> Double {
        Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
    }

    private func percentile95(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return .infinity }
        let sorted = values.sorted()
        return sorted[min(sorted.count - 1, Int(ceil(Double(sorted.count) * 0.95)) - 1)]
    }

    private func record(_ metric: String, samples: [Double], budget: String) {
        let line = String(format: "NATIVE_LATENCY %@: n=%d p95=%.3f ms max=%.3f ms; %@",
                          metric, samples.count, percentile95(samples), samples.max() ?? 0, budget)
        print(line)
        let attachment = XCTAttachment(string: line)
        attachment.name = metric
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

@MainActor
private final class LatencyMessagingService: MessagingService {
    let channel: Channel
    let history: [ChatMessage]
    let baseDate: Date
    private(set) var sendCalls = 0

    init(channel: Channel, history: [ChatMessage], baseDate: Date) {
        self.channel = channel
        self.history = history
        self.baseDate = baseDate
    }

    func channels(cursor: String?) async throws -> ChannelPage { ChannelPage(items: [channel]) }

    func messages(channelID: String, cursor: MessageCursor?) async throws -> MessagePage {
        // A full batch represents the worst-case merge after cache restoration or offline catch-up.
        MessagePage(items: Array(history.reversed()))
    }

    func send(channelID: String, content: String, nonce: String) async throws -> ChatMessage {
        sendCalls += 1
        try await Task.sleep(for: .seconds(30))
        throw URLError(.timedOut)
    }

    func getMessage(channelID: String, messageID: String) async throws -> ChatMessage {
        throw MessagingError.http(404)
    }

    func userNames(userIDs: [String]) async throws -> [String: String] { [:] }
}
