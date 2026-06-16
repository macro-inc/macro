import AVFAudio
import Foundation

enum CallAudioOutputRoute: String {
    case receiver
    case speaker
    case bluetooth
    case headphones
    case external
    case unknown
}

enum CallAudioInputRoute: String {
    case builtInMic
    case bluetooth
    case wired
    case unknown
}

struct CallAudioRouteSnapshot: Equatable {
    let input: CallAudioInputRoute
    let output: CallAudioOutputRoute
    let isSpeakerForced: Bool
    let supportsSpeakerToggle: Bool
}

final class CallAudioRouteController: NSObject, @unchecked Sendable {
    var onRouteChanged: ((CallAudioRouteSnapshot) -> Void)? {
        get {
            onMainSync { routeChangedHandler }
        }
        set {
            let handler = newValue
            onMain { [weak self] in
                self?.routeChangedHandler = handler
            }
        }
    }

    private var routeChangedHandler: ((CallAudioRouteSnapshot) -> Void)?
    private var isObserving = false
    private var isSpeakerForced = false
    private var preferredBuiltInSpeakerEnabled: Bool?

    override init() {
        super.init()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    func startObserving() {
        onMain { [weak self] in
            self?.startObservingOnMain()
        }
    }

    private func startObservingOnMain() {
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
        onMain { [weak self] in
            self?.stopObservingOnMain()
        }
    }

    private func stopObservingOnMain() {
        guard isObserving else { return }
        isObserving = false
        NotificationCenter.default.removeObserver(
            self,
            name: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance()
        )
    }

    func setSpeakerEnabled(_ enabled: Bool) {
        onMain { [weak self] in
            _ = self?.setSpeakerEnabledOnMain(enabled, isUserSelection: true)
        }
    }

    func prepareForCall() {
        onMain { [weak self] in
            self?.preferredBuiltInSpeakerEnabled = nil
            self?.isSpeakerForced = false
            self?.emitCurrentRouteOnMain()
        }
    }

    func defaultToSpeakerIfBuiltInRoute(reason: String) -> Bool {
        onMainSync {
            defaultToSpeakerIfBuiltInRouteOnMain(reason: reason)
        }
    }

    func canDefaultToSpeakerIfBuiltInRoute() -> Bool {
        onMainSync {
            shouldDefaultToSpeakerAfterRouteChange(reason: "sessionDefaultCheck")
        }
    }

    private func defaultToSpeakerIfBuiltInRouteOnMain(reason: String) -> Bool {
        guard preferredBuiltInSpeakerEnabled != false else { return false }
        guard !isCurrentExternalOutputRoute() else {
            print("[CallKit] Skipping built-in speaker default because external route is active reason=\(reason) available=\(describeAvailableRoutes()) current=\(describeCurrentRoute())")
            return false
        }
        let snapshot = currentSnapshotOnMain()
        guard snapshot.supportsSpeakerToggle else { return false }
        if snapshot.output == .speaker, isSpeakerForced {
            return true
        }
        print("[CallKit] Defaulting built-in audio route to speaker reason=\(reason) output=\(snapshot.output.rawValue)")
        return setSpeakerEnabledOnMain(true, isUserSelection: false)
    }

    private func setSpeakerEnabledOnMain(_ enabled: Bool, isUserSelection: Bool) -> Bool {
        let session = AVAudioSession.sharedInstance()
        let snapshot = currentSnapshotOnMain()
        if snapshot.output == .unknown {
            if isUserSelection {
                preferredBuiltInSpeakerEnabled = enabled
            }
            isSpeakerForced = enabled
            print("[CallKit] Queued audio route speaker preference enabled=\(enabled) userSelection=\(isUserSelection); current route is not ready \(describeCurrentRoute())")
            emitCurrentRouteOnMain()
            return false
        }

        do {
            try session.overrideOutputAudioPort(enabled ? .speaker : .none)
            isSpeakerForced = enabled
            if isUserSelection {
                preferredBuiltInSpeakerEnabled = enabled
            }
            print("[CallKit] Audio route speaker override enabled=\(enabled) userSelection=\(isUserSelection) \(describeCurrentRoute())")
            print("[CallKit] Audio route available after speaker override \(describeAvailableRoutes())")
            emitCurrentRouteOnMain()
            return true
        } catch {
            print("[CallKit] Failed to set audio route speaker override enabled=\(enabled): \(error) \(describeCurrentRoute())")
            return false
        }
    }

    func resetSpeakerOverride() {
        onMain { [weak self] in
            self?.resetSpeakerOverrideOnMain()
        }
    }

    private func resetSpeakerOverrideOnMain() {
        preferredBuiltInSpeakerEnabled = nil
        guard isSpeakerForced else { return }
        _ = setSpeakerEnabledOnMain(false, isUserSelection: false)
    }

    func emitCurrentRoute() {
        onMain { [weak self] in
            self?.emitCurrentRouteOnMain()
        }
    }

    private func emitCurrentRouteOnMain() {
        let snapshot = currentSnapshotOnMain()
        print("[CallKit] Audio route policy \(describePolicyState()) snapshot=input:\(snapshot.input.rawValue) output:\(snapshot.output.rawValue) speakerForced:\(snapshot.isSpeakerForced) supportsSpeakerToggle:\(snapshot.supportsSpeakerToggle) current=\(describeCurrentRoute()) \(describeAvailableRoutes())")
        routeChangedHandler?(snapshot)
    }

    func currentRouteSnapshot() -> CallAudioRouteSnapshot {
        onMainSync { currentSnapshotOnMain() }
    }

    func describeCurrentRoute() -> String {
        onMainSync { describeRoute(AVAudioSession.sharedInstance().currentRoute) }
    }

    private func currentSnapshotOnMain() -> CallAudioRouteSnapshot {
        let route = AVAudioSession.sharedInstance().currentRoute
        let output = classifyOutput(route.outputs.first)
        let supportsSpeakerToggle = switch output {
        case .receiver, .speaker, .unknown:
            true
        case .bluetooth, .headphones, .external:
            false
        }
        let snapshotSpeakerForced = isSpeakerForced
            && supportsSpeakerToggle
            && (output == .speaker || output == .receiver || output == .unknown)

        return CallAudioRouteSnapshot(
            input: classifyInput(route.inputs.first),
            output: output,
            isSpeakerForced: snapshotSpeakerForced,
            supportsSpeakerToggle: supportsSpeakerToggle
        )
    }

    @objc private func handleRouteChange(_ notification: Notification) {
        onMain { [weak self] in
            self?.handleRouteChangeOnMain(notification)
        }
    }

    private func handleRouteChangeOnMain(_ notification: Notification) {
        let reason = routeChangeReason(from: notification)
        let previousRoute = notification.userInfo?[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription
        print("[CallKit] Audio route changed reason=\(reason) previous=\(previousRoute.map(describeRoute) ?? "nil") current=\(describeCurrentRoute())")
        print("[CallKit] Audio route available reason=\(reason) \(describeAvailableRoutes())")

        if shouldReleaseSpeakerOverrideForExternalRoute(reason: reason) {
            print("[CallKit] Releasing speaker override for external audio route reason=\(reason)")
            _ = setSpeakerEnabledOnMain(false, isUserSelection: false)
            return
        }

        if shouldApplyQueuedSpeakerOverride(reason: reason) {
            print("[CallKit] Applying queued speaker override after route became available reason=\(reason)")
            _ = setSpeakerEnabledOnMain(true, isUserSelection: false)
            return
        }

        if shouldDefaultToSpeakerAfterRouteChange(reason: reason) {
            print("[CallKit] Built-in speaker default is eligible after route change reason=\(reason)")
        }
        emitCurrentRouteOnMain()
    }

    private func shouldApplyQueuedSpeakerOverride(reason: String) -> Bool {
        guard isSpeakerForced, reason != "override" else { return false }
        guard !isCurrentExternalOutputRoute() else { return false }
        return currentSnapshotOnMain().output == .receiver
    }

    private func shouldDefaultToSpeakerAfterRouteChange(reason: String) -> Bool {
        guard preferredBuiltInSpeakerEnabled != false else { return false }
        guard !isCurrentExternalOutputRoute() else { return false }
        let snapshot = currentSnapshotOnMain()
        guard snapshot.supportsSpeakerToggle, snapshot.output != .unknown else { return false }
        return reason != "override"
    }

    private func shouldReleaseSpeakerOverrideForExternalRoute(reason: String) -> Bool {
        guard isSpeakerForced, reason != "override" else { return false }
        if preferredBuiltInSpeakerEnabled == true, !isCurrentExternalOutputRoute() {
            return false
        }
        return isCurrentExternalOutputRoute()
    }

    private func isCurrentExternalOutputRoute() -> Bool {
        switch currentSnapshotOnMain().output {
        case .bluetooth, .headphones, .external:
            return true
        case .receiver, .speaker, .unknown:
            return false
        }
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
            return .external
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

    private func onMain(_ block: @escaping () -> Void) {
        if Thread.isMainThread {
            block()
        } else {
            DispatchQueue.main.async(execute: block)
        }
    }

    private func onMainSync<T>(_ block: () -> T) -> T {
        if Thread.isMainThread {
            return block()
        }
        return DispatchQueue.main.sync(execute: block)
    }
}
