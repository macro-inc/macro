import CoreLocation
import Foundation
import os
import Tauri
import UIKit

/// Location permission as the web app sees it.
enum GeofencePermission: String {
    case unsupported
    case notDetermined = "not_determined"
    case denied
    case whenInUse = "when_in_use"
    case always
}

/// Owns the app's only `CLLocationManager` and every region it monitors.
/// Region monitoring keeps working while the app is suspended or terminated:
/// iOS relaunches the app in the background for a crossing and delivers the
/// event once a delegate is set, which `start()` does from plugin load.
/// Main thread only.
final class GeofenceMonitor: NSObject, CLLocationManagerDelegate {
    static let shared = GeofenceMonitor()

    /// iOS monitors at most 20 regions per app.
    private static let maxRegions = 20
    private static let regionPrefix = "com.macro.geofence."
    /// How long to wait for the "Change to Always Allow" prompt to cover the
    /// app before concluding iOS will not show it (it does so only once).
    private static let alwaysPromptGrace: TimeInterval = 1

    private enum PermissionStep {
        case whenInUse
        /// The When In Use prompt was answered; the Always prompt shows only
        /// once its alert has gone and the app is active again.
        case awaitingActive
        case always
    }

    private var manager: CLLocationManager?
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var pendingPermissionRequests: [Invoke] = []
    private var permissionStep: PermissionStep?
    private var alwaysPromptShown = false

    func start() {
        guard manager == nil else { return }

        GeofenceStore.dropOrphanedToken()
        let manager = CLLocationManager()
        manager.delegate = self
        self.manager = manager

        for name in [UIApplication.willResignActiveNotification, UIScene.willDeactivateNotification] {
            lifecycleObservers.append(NotificationCenter.default.addObserver(
                forName: name, object: nil, queue: .main
            ) { [weak self] _ in self?.appWillResignActive() })
        }
        for name in [UIApplication.didBecomeActiveNotification, UIScene.didActivateNotification] {
            lifecycleObservers.append(NotificationCenter.default.addObserver(
                forName: name, object: nil, queue: .main
            ) { [weak self] _ in self?.appDidBecomeActive() })
        }

        applyRegions()
    }

    func permission() -> GeofencePermission {
        guard let manager, CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else {
            return .unsupported
        }

        switch manager.authorizationStatus {
        case .notDetermined: return .notDetermined
        case .restricted, .denied: return .denied
        case .authorizedWhenInUse: return .whenInUse
        case .authorizedAlways: return .always
        @unknown default: return .denied
        }
    }

    // MARK: Permission

    /// Asks for When In Use, then upgrades to Always, and resolves with the
    /// resulting permission. iOS shows each prompt at most once; later calls
    /// resolve with the current permission.
    func requestPermission(_ invoke: Invoke) {
        pendingPermissionRequests.append(invoke)
        guard permissionStep == nil else { return }

        advancePermissionRequest()
    }

    private func advancePermissionRequest() {
        guard let manager, permission() != .unsupported else {
            finishPermissionRequest()
            return
        }

        switch manager.authorizationStatus {
        case .notDetermined:
            permissionStep = .whenInUse
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse where UIApplication.shared.applicationState != .active:
            permissionStep = .awaitingActive
        case .authorizedWhenInUse:
            permissionStep = .always
            alwaysPromptShown = false
            manager.requestAlwaysAuthorization()
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.alwaysPromptGrace) { [weak self] in
                guard let self, self.permissionStep == .always, !self.alwaysPromptShown else { return }
                self.finishPermissionRequest()
            }
        default:
            finishPermissionRequest()
        }
    }

    private func finishPermissionRequest() {
        permissionStep = nil
        let requests = pendingPermissionRequests
        pendingPermissionRequests = []
        let payload: JsonObject = ["permission": permission().rawValue]
        for invoke in requests {
            invoke.resolve(payload)
        }
    }

    private func appWillResignActive() {
        if permissionStep == .always {
            alwaysPromptShown = true
        }
    }

    /// Keeping When In Use at the Always prompt changes nothing, so iOS sends
    /// no authorization callback; the app becoming active again ends the step.
    private func appDidBecomeActive() {
        switch permissionStep {
        case .awaitingActive:
            advancePermissionRequest()
        case .always where alwaysPromptShown:
            finishPermissionRequest()
        case .whenInUse, .always, nil:
            break
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        applyRegions()

        switch permissionStep {
        case .whenInUse:
            // Also called once when the manager is created, before any answer.
            guard manager.authorizationStatus != .notDetermined else { return }
            permissionStep = nil
            advancePermissionRequest()
        case .always:
            finishPermissionRequest()
        case .awaitingActive, nil:
            break
        }
    }

    // MARK: Fences

    /// Replaces the monitored set.
    func sync(_ fences: [Fence]) {
        GeofenceStore.setFences(fences)
        applyRegions()
    }

    /// Stops monitoring everything and forgets the device (sign-out).
    func clear() {
        GeofenceStore.clear()
        applyRegions()
    }

    /// Monitors the stored fences nearest the last known location, up to the
    /// iOS limit. Region monitoring delivers events only with Always.
    private func applyRegions() {
        guard let manager else { return }

        let fences = GeofenceStore.device() == nil ? [] : GeofenceStore.fences()
        let monitorable = permission() == .always ? fences : []
        let selected = nearest(monitorable, to: manager.location)
        let wanted = Dictionary(
            selected.map { (Self.regionPrefix + $0.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )

        // Fence ids change whenever their trigger does, so an id names one
        // place, radius and transition.
        var monitored = Set<String>()
        for region in manager.monitoredRegions where region.identifier.hasPrefix(Self.regionPrefix) {
            if wanted[region.identifier] == nil {
                manager.stopMonitoring(for: region)
            } else {
                monitored.insert(region.identifier)
            }
        }

        for (identifier, fence) in wanted where !monitored.contains(identifier) {
            manager.startMonitoring(for: region(for: fence, identifier: identifier, manager: manager))
        }

        // With more fences than regions, re-pick the nearest ones as the
        // phone moves. Significant-change monitoring relaunches the app
        // without the `location` background mode.
        if monitorable.count > Self.maxRegions && CLLocationManager.significantLocationChangeMonitoringAvailable() {
            manager.startMonitoringSignificantLocationChanges()
        } else {
            manager.stopMonitoringSignificantLocationChanges()
        }
    }

    private func nearest(_ fences: [Fence], to location: CLLocation?) -> [Fence] {
        guard fences.count > Self.maxRegions else { return fences }
        guard let location else { return Array(fences.prefix(Self.maxRegions)) }

        let sorted = fences.sorted { left, right in
            distance(from: location, to: left) < distance(from: location, to: right)
        }
        return Array(sorted.prefix(Self.maxRegions))
    }

    private func distance(from location: CLLocation, to fence: Fence) -> CLLocationDistance {
        return location.distance(from: CLLocation(latitude: fence.latitude, longitude: fence.longitude))
    }

    private func region(for fence: Fence, identifier: String, manager: CLLocationManager) -> CLCircularRegion {
        let region = CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: fence.latitude, longitude: fence.longitude),
            radius: min(fence.radiusMeters, manager.maximumRegionMonitoringDistance),
            identifier: identifier
        )
        region.notifyOnEntry = fence.on == .arrive
        region.notifyOnExit = fence.on == .leave
        return region
    }

    // MARK: Crossings

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        report(region, crossed: .arrive)
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        report(region, crossed: .leave)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        applyRegions()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        geofenceLog("Location update failed: \(error.localizedDescription)", level: .error)
    }

    func locationManager(
        _ manager: CLLocationManager,
        monitoringDidFailFor region: CLRegion?,
        withError error: Error
    ) {
        geofenceLog(
            "Monitoring failed region=\(region?.identifier ?? "none") error=\(error.localizedDescription)",
            level: .error
        )
    }

    private func report(_ region: CLRegion, crossed transition: FenceTransition) {
        guard region.identifier.hasPrefix(Self.regionPrefix) else { return }

        let fenceId = String(region.identifier.dropFirst(Self.regionPrefix.count))
        guard
            let device = GeofenceStore.device(),
            let fence = GeofenceStore.fences().first(where: { $0.id == fenceId }),
            fence.on == transition
        else { return }

        GeofenceReporter.report(fenceId: fenceId, on: transition, device: device) { [weak self] outcome in
            self?.handle(outcome, fenceId: fenceId, reportedWith: device)
        }
        // The crossing usually moved the phone; re-pick the nearest fences.
        applyRegions()
    }

    private func handle(_ outcome: ReportOutcome, fenceId: String, reportedWith device: GeofenceDevice) {
        // A sign-out or a new device may have replaced the credentials while
        // the report was in flight; its answer then no longer applies.
        guard GeofenceStore.device() == device else { return }

        switch outcome {
        case .unauthorized:
            GeofenceStore.clear()
            applyRegions()
        case .fenceGone:
            GeofenceStore.removeFence(id: fenceId)
            applyRegions()
        case .accepted, .failed:
            break
        }
    }
}
