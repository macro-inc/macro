import Foundation
import Tauri
import WebKit

struct WatchCallAnsweredArgs: Decodable {
    let channel: Channel
}

struct WatchCallEndedArgs: Decodable {
    let channel: Channel
}

struct SetVideoEnabledArgs: Decodable {
    let enabled: Bool
}

struct SetVideoOverlayModeArgs: Decodable {
    let mode: String
}

/// Tauri command/event facade; platform work lives in the coordinator/session.
class CallKitPlugin: Plugin, @unchecked Sendable {
    private var mediaSession: NativeLiveKitCallSession?
    private var callCoordinator: IncomingCallCoordinator!
    private let videoOverlay = CallVideoOverlayController()

    // Singleton channels avoid leaking listeners across webview reloads/HMR.
    private var callAnsweredChannel: Channel?
    private var callEndedChannel: Channel?

    override public func load(webview: WKWebView) {
        print("[CallKit] Tauri CallKitPlugin loading")
        callCoordinator = IncomingCallCoordinator(
            mediaSession: { [weak self] in
                guard let self else {
                    print("[CallKit] Media session requested after plugin deallocation; returning inert session")
                    return NativeLiveKitCallSession(
                        onSnapshotChanged: { _ in },
                        requestSystemEndCall: { _ in },
                        videoOverlay: CallVideoOverlayController()
                    )
                }
                return self.getMediaSession()
            },
            onVoipTokenUpdated: { [weak self] token in
                print("[CallKit] Emitting voip-token-updated event tokenLength=\(token.count)")
                self?.trigger("voip-token-updated", data: ["token": token])
            },
            onCallAnswered: { [weak self] channelId, nativeMedia in
                guard let channel = self?.callAnsweredChannel else {
                    print("[CallKit] No JS call answered channel registered; caching handled by coordinator channelId=\(channelId) nativeMedia=\(nativeMedia)")
                    return
                }
                print("[CallKit] Sending call answered channel message channelId=\(channelId) nativeMedia=\(nativeMedia)")
                let payload: JsonObject = ["channelId": channelId, "nativeMedia": nativeMedia]
                channel.send(payload)
            },
            onCallEnded: { [weak self] callId in
                guard let channel = self?.callEndedChannel else {
                    print("[CallKit] No JS call ended channel registered callId=\(callId)")
                    return
                }
                print("[CallKit] Sending call ended channel message callId=\(callId)")
                let payload: JsonObject = ["callId": callId]
                channel.send(payload)
            }
        )
        videoOverlay.attach(to: webview)
        callCoordinator.load()
        print("[CallKit] Tauri CallKitPlugin loaded")
    }

    @objc public func watchCallAnswered(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(WatchCallAnsweredArgs.self)
        onMain { [weak self] in
            print("[CallKit] JS registered call answered watcher")
            self?.callAnsweredChannel = args.channel
            invoke.resolve()
        }
    }

    @objc public func watchCallEnded(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(WatchCallEndedArgs.self)
        onMain { [weak self] in
            print("[CallKit] JS registered call ended watcher")
            self?.callEndedChannel = args.channel
            invoke.resolve()
        }
    }

    @objc public func getVoipToken(_ invoke: Invoke) {
        onMain { [weak self] in
            print("[CallKit] JS requested cached VoIP token")
            invoke.resolve(["token": self?.callCoordinator.getVoipToken() as Any])
        }
    }

    @objc public func getPendingAnsweredCall(_ invoke: Invoke) {
        onMain { [weak self] in
            let answeredCall = self?.callCoordinator.drainPendingAnsweredCall()
            print("[CallKit] JS drained pending answered call channelId=\(answeredCall?.channelId ?? "nil") nativeMedia=\(answeredCall?.nativeMedia ?? false)")
            invoke.resolve([
                "channelId": answeredCall?.channelId as Any,
                "nativeMedia": answeredCall?.nativeMedia as Any,
            ])
        }
    }

    @objc public func getActiveCallState(_ invoke: Invoke) {
        onMain { [weak self] in
            guard let snapshot = self?.mediaSession?.currentSnapshot() else {
                print("[CallKit] JS requested active call state: none")
                invoke.resolve(["state": NSNull()])
                return
            }

            print("[CallKit] JS requested active call state: \(snapshot.connectionState) channelId=\(snapshot.channelId) callId=\(snapshot.callId)")
            invoke.resolve([
                "state": [
                    "channelId": snapshot.channelId,
                    "callId": snapshot.callId,
                    "connectionState": snapshot.connectionState,
                    "isAudioMuted": snapshot.isAudioMuted,
                    "isVideoMuted": snapshot.isVideoMuted,
                    "videoOverlayMode": snapshot.videoOverlayMode,
                ] as JsonObject
            ])
        }
    }

    @objc public func endActiveCall(_ invoke: Invoke) {
        onMain { [weak self] in
            guard let self else {
                print("[CallKit] JS requested endActiveCall after plugin deallocation")
                invoke.resolve()
                return
            }
            print("[CallKit] JS requested endActiveCall")
            self.callCoordinator.endActiveCall {
                invoke.resolve()
            }
        }
    }

    @objc public func setVideoEnabled(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SetVideoEnabledArgs.self)
        onMain { [weak self] in
            print("[CallKit] JS requested native video enabled=\(args.enabled)")
            self?.mediaSession?.setVideoEnabled(args.enabled)
            invoke.resolve()
        }
    }

    @objc public func setVideoOverlayMode(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SetVideoOverlayModeArgs.self)
        onMain { [weak self] in
            let mode = CallVideoOverlayMode(rawValue: args.mode) ?? .minimized
            print("[CallKit] JS requested native video overlay mode=\(mode.rawValue)")
            self?.mediaSession?.setVideoOverlayMode(mode)
            invoke.resolve()
        }
    }

    @objc public func switchCamera(_ invoke: Invoke) {
        onMain { [weak self] in
            print("[CallKit] JS requested native camera switch")
            self?.mediaSession?.switchCamera()
            invoke.resolve()
        }
    }

    private func emitConnectionState(_ snapshot: ActiveCallSnapshot?) {
        let payload: JSObject
        if let snapshot {
            print("[CallKit] Triggering connection-state event state=\(snapshot.connectionState) channelId=\(snapshot.channelId) callId=\(snapshot.callId)")
            payload = [
                "state": snapshot.connectionState,
                "channelId": snapshot.channelId,
                "callId": snapshot.callId,
                "isAudioMuted": snapshot.isAudioMuted,
                "isVideoMuted": snapshot.isVideoMuted,
                "videoOverlayMode": snapshot.videoOverlayMode,
            ]
        } else {
            print("[CallKit] Triggering connection-state event state=disconnected")
            payload = [
                "state": "disconnected",
                "channelId": NSNull(),
                "callId": NSNull(),
                "isAudioMuted": false,
                "isVideoMuted": true,
                "videoOverlayMode": "hidden",
            ]
        }
        trigger("connection-state", data: payload)
    }

    private func getMediaSession() -> NativeLiveKitCallSession {
        if let mediaSession {
            print("[CallKit] Reusing NativeLiveKitCallSession")
            return mediaSession
        }

        print("[CallKit] Creating NativeLiveKitCallSession")
        let mediaSession = NativeLiveKitCallSession(
            onSnapshotChanged: { [weak self] snapshot in
                self?.emitConnectionState(snapshot)
            },
            requestSystemEndCall: { [weak self] uuid in
                self?.callCoordinator.requestEndCall(uuid: uuid)
            },
            videoOverlay: videoOverlay
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
