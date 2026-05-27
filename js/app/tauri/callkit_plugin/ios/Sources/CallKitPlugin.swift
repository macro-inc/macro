import Foundation
import Tauri
import WebKit

struct WatchCallAnsweredArgs: Decodable {
    let channel: Channel
}

struct WatchCallEndedArgs: Decodable {
    let channel: Channel
}

/// Tauri command/event facade; platform work lives in the coordinator/session.
class CallKitPlugin: Plugin, @unchecked Sendable {
    private var mediaSession: NativeLiveKitCallSession?
    private var callCoordinator: IncomingCallCoordinator!

    // Singleton channels avoid leaking listeners across webview reloads/HMR.
    private var callAnsweredChannel: Channel?
    private var callEndedChannel: Channel?

    override public func load(webview: WKWebView) {
        callCoordinator = IncomingCallCoordinator(
            mediaSession: { [weak self] in
                guard let self else {
                    return NativeLiveKitCallSession(
                        onSnapshotChanged: { _ in },
                        requestSystemEndCall: { _ in }
                    )
                }
                return self.getMediaSession()
            },
            onVoipTokenUpdated: { [weak self] token in
                self?.trigger("voip-token-updated", data: ["token": token])
            },
            onCallAnswered: { [weak self] channelId in
                guard let channel = self?.callAnsweredChannel else { return }
                let payload: JsonObject = ["channelId": channelId]
                channel.send(payload)
            },
            onCallEnded: { [weak self] callId in
                guard let channel = self?.callEndedChannel else { return }
                let payload: JsonObject = ["callId": callId]
                channel.send(payload)
            }
        )
        callCoordinator.load()
    }

    @objc public func watchCallAnswered(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(WatchCallAnsweredArgs.self)
        onMain { [weak self] in
            self?.callAnsweredChannel = args.channel
            invoke.resolve()
        }
    }

    @objc public func watchCallEnded(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(WatchCallEndedArgs.self)
        onMain { [weak self] in
            self?.callEndedChannel = args.channel
            invoke.resolve()
        }
    }

    @objc public func getVoipToken(_ invoke: Invoke) {
        onMain { [weak self] in
            invoke.resolve(["token": self?.callCoordinator.getVoipToken() as Any])
        }
    }

    @objc public func getPendingAnsweredCall(_ invoke: Invoke) {
        onMain { [weak self] in
            let channelId = self?.callCoordinator.drainPendingAnsweredChannelId()
            invoke.resolve(["channelId": channelId as Any])
        }
    }

    @objc public func getActiveCallState(_ invoke: Invoke) {
        onMain { [weak self] in
            guard let snapshot = self?.mediaSession?.currentSnapshot() else {
                invoke.resolve(["state": NSNull()])
                return
            }

            invoke.resolve([
                "state": [
                    "channelId": snapshot.channelId,
                    "callId": snapshot.callId,
                    "connectionState": snapshot.connectionState,
                    "isAudioMuted": snapshot.isAudioMuted,
                ] as JsonObject
            ])
        }
    }

    @objc public func endActiveCall(_ invoke: Invoke) {
        onMain { [weak self] in
            guard let self else {
                invoke.resolve()
                return
            }
            self.callCoordinator.endActiveCall {
                invoke.resolve()
            }
        }
    }

    private func emitConnectionState(_ snapshot: ActiveCallSnapshot?) {
        let payload: JSObject
        if let snapshot {
            payload = [
                "state": snapshot.connectionState,
                "channelId": snapshot.channelId,
                "callId": snapshot.callId,
                "isAudioMuted": snapshot.isAudioMuted,
            ]
        } else {
            payload = [
                "state": "disconnected",
                "channelId": NSNull(),
                "callId": NSNull(),
                "isAudioMuted": false,
            ]
        }
        trigger("connection-state", data: payload)
    }

    private func getMediaSession() -> NativeLiveKitCallSession {
        if let mediaSession {
            return mediaSession
        }

        let mediaSession = NativeLiveKitCallSession(
            onSnapshotChanged: { [weak self] snapshot in
                self?.emitConnectionState(snapshot)
            },
            requestSystemEndCall: { [weak self] uuid in
                self?.callCoordinator.requestEndCall(uuid: uuid)
            }
        )
        self.mediaSession = mediaSession
        return mediaSession
    }

    private func onMain(_ block: @escaping () -> Void) {
        if Thread.isMainThread {
            block()
        } else {
            DispatchQueue.main.async(execute: block)
        }
    }
}

@_cdecl("init_plugin_call_kit")
func initPlugin() -> Plugin {
    return CallKitPlugin()
}
