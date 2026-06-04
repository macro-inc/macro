import Foundation
import Tauri
import UIKit
import WebKit

struct WatchCallAnsweredArgs: Decodable {
    let channel: Channel
}

struct WatchCallEndedArgs: Decodable {
    let channel: Channel
}

struct WatchConnectionStateArgs: Decodable {
    let channel: Channel
}

struct WatchDrawerOpenedArgs: Decodable {
    let channel: Channel
}

struct WatchParticipantIdentitiesArgs: Decodable {
    let channel: Channel
}

struct SetVideoEnabledArgs: Decodable {
    let enabled: Bool
}

struct SetVideoOverlayModeArgs: Decodable {
    let mode: String
}

struct SetCallDrawerChannelTitleArgs: Decodable {
    let channelTitle: String?
}

/// Tauri command/event facade; platform work lives in the coordinator/session.
class CallKitPlugin: Plugin, @unchecked Sendable {
    private var mediaSession: NativeLiveKitCallSession?
    private var callCoordinator: IncomingCallCoordinator!
    private let videoOverlay = CallVideoOverlayController()
    private var pendingParticipantDisplayNamesByIdentity: [String: String] = [:]

    // Singleton channels avoid leaking listeners across webview reloads/HMR.
    private var callAnsweredChannel: Channel?
    private var callEndedChannel: Channel?
    private var connectionStateChannel: Channel?
    private var drawerOpenedChannel: Channel?
    private var participantIdentitiesChannel: Channel?
    private var willTerminateObserver: NSObjectProtocol?

    deinit {
        if let willTerminateObserver {
            NotificationCenter.default.removeObserver(willTerminateObserver)
        }
    }

    override public func load(webview: WKWebView) {
        print("[CallKit] Tauri CallKitPlugin loading")
        callCoordinator = IncomingCallCoordinator(
            mediaSession: { [weak self] in
                guard let self else {
                    print("[CallKit] Media session requested after plugin deallocation; returning inert session")
                    return NativeLiveKitCallSession(
                        onSnapshotChanged: { _ in },
                        requestSystemEndCall: { _ in },
                        onDrawerOpened: { _ in },
                        onParticipantIdentitiesChanged: { _ in },
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
                let eventPayload: JSObject = ["channelId": channelId, "nativeMedia": nativeMedia]
                print("[CallKit] Triggering call answered event channelId=\(channelId) nativeMedia=\(nativeMedia)")
                self?.trigger("call-answered", data: eventPayload)
                if let channel = self?.callAnsweredChannel {
                    let channelPayload: JsonObject = ["channelId": channelId, "nativeMedia": nativeMedia]
                    channel.send(channelPayload)
                }
            },
            onCallEnded: { [weak self] callId in
                let eventPayload: JSObject = ["callId": callId]
                print("[CallKit] Triggering call ended event callId=\(callId)")
                self?.trigger("call-ended", data: eventPayload)
                if let channel = self?.callEndedChannel {
                    let channelPayload: JsonObject = ["callId": callId]
                    channel.send(channelPayload)
                }
            }
        )
        videoOverlay.attach(to: webview)
        callCoordinator.load()
        observeApplicationTermination()
        print("[CallKit] Tauri CallKitPlugin loaded")
    }

    private func observeApplicationTermination() {
        if let willTerminateObserver {
            NotificationCenter.default.removeObserver(willTerminateObserver)
        }
        willTerminateObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willTerminateNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            print("[CallKit] UIApplication will terminate")
            self?.callCoordinator.handleApplicationWillTerminate()
        }
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

    @objc public func watchConnectionState(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(WatchConnectionStateArgs.self)
        onMain { [weak self] in
            print("[CallKit] JS registered connection state watcher")
            self?.connectionStateChannel = args.channel
            invoke.resolve()
        }
    }

    @objc public func watchDrawerOpened(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(WatchDrawerOpenedArgs.self)
        onMain { [weak self] in
            print("[CallKit] JS registered drawer opened watcher")
            self?.drawerOpenedChannel = args.channel
            invoke.resolve()
        }
    }

    @objc public func watchParticipantIdentities(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(WatchParticipantIdentitiesArgs.self)
        onMain { [weak self] in
            print("[CallKit] JS registered participant identities watcher")
            self?.participantIdentitiesChannel = args.channel
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
            let participantIdentities = self?.mediaSession?.currentParticipantIdentities() ?? []
            invoke.resolve([
                "state": [
                    "channelId": snapshot.channelId,
                    "callId": snapshot.callId,
                    "connectionState": snapshot.connectionState,
                    "isAudioMuted": snapshot.isAudioMuted,
                    "isVideoMuted": snapshot.isVideoMuted,
                    "videoOverlayMode": snapshot.videoOverlayMode,
                    "participantIdentities": participantIdentities,
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

    @objc public func startOutgoingCall(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(StartOutgoingCallArgs.self)
        onMain { [weak self] in
            guard let self else {
                print("[CallKit] JS requested startOutgoingCall after plugin deallocation")
                invoke.reject("CallKit plugin is not available")
                return
            }
            guard let uuid = UUID(uuidString: args.callId) else {
                print("[CallKit] JS requested startOutgoingCall with invalid callId=\(args.callId)")
                invoke.reject("Invalid callId")
                return
            }

            print("[CallKit] JS requested startOutgoingCall uuid=\(uuid.uuidString) channelId=\(args.channelId)")
            self.callCoordinator.startOutgoingCall(
                uuid: uuid,
                channelId: args.channelId,
                channelName: args.channelTitle,
                callerName: args.callerName,
                serverUrl: args.serverUrl,
                token: args.token
            ) { error in
                if let error {
                    invoke.reject(error.localizedDescription)
                } else {
                    invoke.resolve(["uuid": uuid.uuidString])
                }
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

    @objc public func setCallDrawerChannelTitle(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SetCallDrawerChannelTitleArgs.self)
        onMain { [weak self] in
            print("[CallKit] JS requested call drawer channelTitle=\(args.channelTitle ?? "nil")")
            self?.videoOverlay.setChannelTitle(args.channelTitle)
            invoke.resolve()
        }
    }

    @objc public func setCallDrawerTheme(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SetCallDrawerThemeArgs.self)
        onMain { [weak self] in
            let theme = CallVideoOverlayTheme(
                drawerBackgroundColor: Self.uiColor(args.drawerBackground),
                textColor: Self.uiColor(args.text),
                messageBackgroundColor: Self.uiColor(args.messageBackground),
                overlayBackgroundColor: Self.uiColor(args.overlayBackground),
                edgeMutedColor: Self.uiColor(args.edgeMuted),
                edgeColor: Self.uiColor(args.edge),
                inkMutedColor: Self.uiColor(args.inkMuted),
                failureColor: Self.uiColor(args.failure),
                failureInkColor: Self.uiColor(args.failureInk),
                successColor: Self.uiColor(args.success)
            )
            self?.videoOverlay.setTheme(theme)
            invoke.resolve()
        }
    }

    @objc public func setParticipantDisplayName(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SetParticipantDisplayNameArgs.self)
        onMain { [weak self] in
            print("[CallKit] JS requested participant display name identity=\(args.identity) displayName=\(args.displayName ?? "nil")")
            self?.setParticipantDisplayName(
                identity: args.identity,
                displayName: args.displayName
            )
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
        let eventPayload: JSObject
        let channelPayload: JsonObject
        if let snapshot {
            print("[CallKit] Sending connection state channel message state=\(snapshot.connectionState) channelId=\(snapshot.channelId) callId=\(snapshot.callId)")
            if snapshot.connectionState == "connected",
               let uuid = UUID(uuidString: snapshot.callId) {
                callCoordinator.reportNativeCallConnected(uuid: uuid)
            }
            eventPayload = [
                "state": snapshot.connectionState,
                "channelId": snapshot.channelId,
                "callId": snapshot.callId,
                "isAudioMuted": snapshot.isAudioMuted,
                "isVideoMuted": snapshot.isVideoMuted,
                "videoOverlayMode": snapshot.videoOverlayMode,
            ]
            channelPayload = [
                "state": snapshot.connectionState,
                "channelId": snapshot.channelId,
                "callId": snapshot.callId,
                "isAudioMuted": snapshot.isAudioMuted,
                "isVideoMuted": snapshot.isVideoMuted,
                "videoOverlayMode": snapshot.videoOverlayMode,
            ]
        } else {
            print("[CallKit] Sending connection state channel message state=disconnected")
            eventPayload = [
                "state": "disconnected",
                "channelId": NSNull(),
                "callId": NSNull(),
                "isAudioMuted": false,
                "isVideoMuted": true,
                "videoOverlayMode": "hidden",
            ]
            channelPayload = [
                "state": "disconnected",
                "channelId": NSNull(),
                "callId": NSNull(),
                "isAudioMuted": false,
                "isVideoMuted": true,
                "videoOverlayMode": "hidden",
            ]
        }
        trigger("connection-state", data: eventPayload)
        if let channel = connectionStateChannel {
            channel.send(channelPayload)
        }
    }

    private func emitDrawerOpened(channelId: String) {
        let eventPayload: JSObject = ["channelId": channelId]
        print("[CallKit] Triggering drawer opened event channelId=\(channelId)")
        trigger("drawer-opened", data: eventPayload)
        if let channel = drawerOpenedChannel {
            let channelPayload: JsonObject = ["channelId": channelId]
            channel.send(channelPayload)
        }
    }

    private func emitParticipantIdentities(_ identities: [String]) {
        let eventPayload: JSObject = ["identities": identities]
        print("[CallKit] Triggering participant identities event identities=\(identities)")
        trigger("participant-identities", data: eventPayload)
        if let channel = participantIdentitiesChannel {
            let channelPayload: JsonObject = ["identities": identities]
            channel.send(channelPayload)
        }
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
            onDrawerOpened: { [weak self] channelId in
                self?.emitDrawerOpened(channelId: channelId)
            },
            onParticipantIdentitiesChanged: { [weak self] identities in
                self?.emitParticipantIdentities(identities)
            },
            videoOverlay: videoOverlay
        )
        self.mediaSession = mediaSession
        replayPendingParticipantDisplayNames(to: mediaSession)
        return mediaSession
    }

    private func setParticipantDisplayName(identity: String, displayName: String?) {
        if let mediaSession {
            mediaSession.setParticipantDisplayName(identity: identity, displayName: displayName)
            return
        }

        let trimmedName = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmedName, !trimmedName.isEmpty {
            pendingParticipantDisplayNamesByIdentity[identity] = trimmedName
            print("[CallKit] Cached participant display name until native session exists identity=\(identity) displayName=\(trimmedName)")
        } else {
            pendingParticipantDisplayNamesByIdentity.removeValue(forKey: identity)
            print("[CallKit] Cleared pending participant display name before native session exists identity=\(identity)")
        }
    }

    private func replayPendingParticipantDisplayNames(to mediaSession: NativeLiveKitCallSession) {
        guard !pendingParticipantDisplayNamesByIdentity.isEmpty else { return }

        print("[CallKit] Replaying pending participant display names count=\(pendingParticipantDisplayNamesByIdentity.count)")
        for (identity, displayName) in pendingParticipantDisplayNamesByIdentity {
            mediaSession.setParticipantDisplayName(identity: identity, displayName: displayName)
        }
        pendingParticipantDisplayNamesByIdentity.removeAll()
    }

    private func onMain(_ block: @escaping () -> Void) {
        if Thread.isMainThread {
            block()
        } else {
            DispatchQueue.main.async(execute: block)
        }
    }

    private static func uiColor(_ color: RgbaColorArgs) -> UIColor {
        UIColor(
            red: max(0, min(1, color.red)),
            green: max(0, min(1, color.green)),
            blue: max(0, min(1, color.blue)),
            alpha: max(0, min(1, color.alpha ?? 1))
        )
    }
}

@_cdecl("init_plugin_call_kit")
func initPlugin() -> Plugin {
    return CallKitPlugin()
}
