import Network
import Tauri
import WebKit

private struct WatchStatusArgs: Decodable {
    let channel: Channel
}

private enum NetworkStatus: String {
    case unknown
    case online
    case offline
}

final class NetworkStatusPlugin: Plugin, @unchecked Sendable {
    private let monitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(
        label: "com.macro.network-status",
        qos: .utility
    )
    private let stateLock = NSLock()
    private var status = NetworkStatus.unknown
    private var statusChannel: Channel?

    override public func load(webview: WKWebView) {
        monitor.pathUpdateHandler = { [weak self] path in
            self?.updateStatus(path.status == .satisfied ? .online : .offline)
        }
        monitor.start(queue: monitorQueue)
    }

    deinit {
        monitor.cancel()
    }

    @objc public func watchStatus(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(WatchStatusArgs.self)
        let currentStatus: NetworkStatus

        stateLock.lock()
        statusChannel = args.channel
        currentStatus = status
        stateLock.unlock()

        args.channel.send(statusPayload(currentStatus))
        invoke.resolve()
    }

    private func updateStatus(_ nextStatus: NetworkStatus) {
        let channel: Channel?

        stateLock.lock()
        guard status != nextStatus else {
            stateLock.unlock()
            return
        }
        status = nextStatus
        channel = statusChannel
        stateLock.unlock()

        channel?.send(statusPayload(nextStatus))
    }

    private func statusPayload(_ value: NetworkStatus) -> JsonObject {
        return ["status": value.rawValue]
    }
}

@_cdecl("init_plugin_network_status")
public func initPlugin() -> Plugin {
    return NetworkStatusPlugin()
}
