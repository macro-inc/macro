import AVFAudio
import Foundation

enum CallAudioOutputRoute: String {
    case receiver
    case speaker
    case bluetooth
    case headphones
    case unknown
}

enum CallAudioInputRoute: String {
    case builtInMic
    case bluetooth
    case wired
    case unknown
}

struct CallAudioRouteSnapshot {
    let input: CallAudioInputRoute
    let output: CallAudioOutputRoute
    let isSpeakerForced: Bool
    let supportsSpeakerToggle: Bool
}

final class CallAudioRouteController: NSObject, @unchecked Sendable {
    var onRouteChanged: ((CallAudioRouteSnapshot) -> Void)?

    private var isObserving = false
    private var isSpeakerForced = false
    private var preferredBuiltInSpeakerEnabled: Bool?

    override init() {
        super.init()
    }

    deinit {
        stopObserving()
    }

    func startObserving() {
        guard !isObserving else { return }
        isObserving = true
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleRouteChange(_:)),
            name: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance()
        )
        print("[CallKit] Audio route observing started \(describeCurrentRoute())")
        emitCurrentRoute()
    }

    func stopObserving() {
        guard isObserving else { return }
        isObserving = false
        NotificationCenter.default.removeObserver(
            self,
            name: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance()
        )
    }

    func setSpeakerEnabled(_ enabled: Bool) {
        setSpeakerEnabled(enabled, isUserSelection: true)
    }

    func prepareForCall() {
        preferredBuiltInSpeakerEnabled = nil
        isSpeakerForced = false
        emitCurrentRoute()
    }

    func defaultToSpeakerIfBuiltInRoute(reason: String) {
        guard preferredBuiltInSpeakerEnabled != false else { return }
        guard !isExternalRouteAvailable() else {
            print("[CallKit] Skipping built-in speaker default because external route is available reason=\(reason) available=\(describeAvailableRoutes()) current=\(describeCurrentRoute())")
            return
        }
        let snapshot = currentSnapshot()
        guard snapshot.supportsSpeakerToggle, snapshot.output != .speaker else { return }
        print("[CallKit] Defaulting built-in audio route to speaker reason=\(reason) output=\(snapshot.output.rawValue)")
        setSpeakerEnabled(true, isUserSelection: false)
    }

    private func setSpeakerEnabled(_ enabled: Bool, isUserSelection: Bool) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.overrideOutputAudioPort(enabled ? .speaker : .none)
            isSpeakerForced = enabled
            if isUserSelection {
                preferredBuiltInSpeakerEnabled = enabled
            }
            print("[CallKit] Audio route speaker override enabled=\(enabled) userSelection=\(isUserSelection) \(describeCurrentRoute())")
            print("[CallKit] Audio route available after speaker override \(describeAvailableRoutes())")
            emitCurrentRoute()
        } catch {
            print("[CallKit] Failed to set audio route speaker override enabled=\(enabled): \(error) \(describeCurrentRoute())")
        }
    }

    func resetSpeakerOverride() {
        preferredBuiltInSpeakerEnabled = nil
        guard isSpeakerForced else { return }
        setSpeakerEnabled(false, isUserSelection: false)
    }

    func emitCurrentRoute() {
        let snapshot = currentSnapshot()
        print("[CallKit] Audio route policy \(describePolicyState()) snapshot=input:\(snapshot.input.rawValue) output:\(snapshot.output.rawValue) speakerForced:\(snapshot.isSpeakerForced) supportsSpeakerToggle:\(snapshot.supportsSpeakerToggle) current=\(describeCurrentRoute()) \(describeAvailableRoutes())")
        onRouteChanged?(snapshot)
    }

    func currentRouteSnapshot() -> CallAudioRouteSnapshot {
        currentSnapshot()
    }

    func describeCurrentRoute() -> String {
        describeRoute(AVAudioSession.sharedInstance().currentRoute)
    }

    private func currentSnapshot() -> CallAudioRouteSnapshot {
        let route = AVAudioSession.sharedInstance().currentRoute
        let output = classifyOutput(route.outputs.first)
        let supportsSpeakerToggle = output == .receiver || output == .speaker || output == .unknown
        if !supportsSpeakerToggle {
            isSpeakerForced = false
        }

        return CallAudioRouteSnapshot(
            input: classifyInput(route.inputs.first),
            output: output,
            isSpeakerForced: isSpeakerForced && output == .speaker,
            supportsSpeakerToggle: supportsSpeakerToggle
        )
    }

    @objc private func handleRouteChange(_ notification: Notification) {
        let reason = routeChangeReason(from: notification)
        let previousRoute = notification.userInfo?[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription
        print("[CallKit] Audio route changed reason=\(reason) previous=\(previousRoute.map(describeRoute) ?? "nil") current=\(describeCurrentRoute())")
        print("[CallKit] Audio route available reason=\(reason) \(describeAvailableRoutes())")

        if shouldReleaseSpeakerOverrideForExternalRoute(reason: reason) {
            print("[CallKit] Releasing speaker override for external audio route reason=\(reason)")
            setSpeakerEnabled(false, isUserSelection: false)
            return
        }

        if shouldDefaultToSpeakerAfterRouteChange(reason: reason) {
            defaultToSpeakerIfBuiltInRoute(reason: "routeChange:\(reason)")
            return
        }
        emitCurrentRoute()
    }

    private func shouldDefaultToSpeakerAfterRouteChange(reason: String) -> Bool {
        guard preferredBuiltInSpeakerEnabled != false else { return false }
        guard !isExternalRouteAvailable() else { return false }
        guard currentSnapshot().supportsSpeakerToggle else { return false }
        return reason != "override"
    }

    private func shouldReleaseSpeakerOverrideForExternalRoute(reason: String) -> Bool {
        guard isSpeakerForced, reason != "override" else { return false }
        if currentSnapshot().output != .speaker {
            return true
        }
        return isExternalRouteAvailable()
    }

    private func isExternalRouteAvailable() -> Bool {
        let inputs = AVAudioSession.sharedInstance().availableInputs ?? []
        return inputs.contains { port in
            isExternalInput(port)
        }
    }

    private func isExternalInput(_ port: AVAudioSessionPortDescription) -> Bool {
        port.portType == .bluetoothHFP
            || port.portType == .bluetoothLE
            || port.portType == .headsetMic
    }

    private func describeAvailableRoutes() -> String {
        let inputs = (AVAudioSession.sharedInstance().availableInputs ?? [])
            .map(describePort)
            .joined(separator: ",")
        return "availableInputs=[\(inputs)]"
    }

    private func describePolicyState() -> String {
        "speakerForced=\(isSpeakerForced) preferredBuiltInSpeaker=\(preferredBuiltInSpeakerEnabled.map(String.init) ?? "nil") externalAvailable=\(isExternalRouteAvailable())"
    }

    private func classifyInput(_ port: AVAudioSessionPortDescription?) -> CallAudioInputRoute {
        guard let port else { return .unknown }
        switch port.portType {
        case .builtInMic:
            return .builtInMic
        case .bluetoothHFP, .bluetoothLE:
            return .bluetooth
        case .headsetMic:
            return .wired
        default:
            return .unknown
        }
    }

    private func routeChangeReason(from notification: Notification) -> String {
        guard
            let rawReason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
            let reason = AVAudioSession.RouteChangeReason(rawValue: rawReason)
        else {
            return "unknown"
        }

        switch reason {
        case .unknown: return "unknown"
        case .newDeviceAvailable: return "newDeviceAvailable"
        case .oldDeviceUnavailable: return "oldDeviceUnavailable"
        case .categoryChange: return "categoryChange"
        case .override: return "override"
        case .wakeFromSleep: return "wakeFromSleep"
        case .noSuitableRouteForCategory: return "noSuitableRouteForCategory"
        case .routeConfigurationChange: return "routeConfigurationChange"
        @unknown default: return "unknown"
        }
    }

    private func classifyOutput(_ port: AVAudioSessionPortDescription?) -> CallAudioOutputRoute {
        guard let port else { return .unknown }
        switch port.portType {
        case .builtInReceiver:
            return .receiver
        case .builtInSpeaker:
            return .speaker
        case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE:
            return .bluetooth
        case .headphones:
            return .headphones
        default:
            return .unknown
        }
    }

    private func describeRoute(_ route: AVAudioSessionRouteDescription) -> String {
        let inputs = route.inputs.map(describePort).joined(separator: ",")
        let outputs = route.outputs.map(describePort).joined(separator: ",")
        return "inputs=[\(inputs)] outputs=[\(outputs)]"
    }

    private func describePort(_ port: AVAudioSessionPortDescription) -> String {
        "\(port.portType.rawValue):\(port.portName):uid=\(port.uid)"
    }
}
