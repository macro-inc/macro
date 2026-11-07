import Foundation
import UIKit
import os

private let geofenceLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.macro.app", category: "Geofence")

/// Writes a `[Geofence]` line to the unified log as public text, so it must
/// never contain the token, coordinates, place names or other personal data.
func geofenceLog(_ message: String, level: OSLogType = .default) {
    geofenceLogger.log(level: level, "[Geofence] \(message, privacy: .public)")
}

/// What the report endpoint said about a crossing.
enum ReportOutcome {
    case accepted
    /// The token is unknown or revoked: forget the device and its fences.
    case unauthorized
    /// The fence no longer exists: stop monitoring it.
    case fenceGone
    case failed
}

/// Posts `{ fence, on }` to the stored report URL. A crossing can relaunch
/// the app in the background for a few seconds only, so the request runs
/// under a background task. It is fire-and-forget: a lost report only means
/// that crossing does not start its routine.
enum GeofenceReporter {
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        return URLSession(configuration: config)
    }()

    private struct ReportBody: Encodable {
        let fence: String
        let on: FenceTransition
    }

    /// Calls `completion` on the main thread.
    static func report(
        fenceId: String,
        on transition: FenceTransition,
        device: GeofenceDevice,
        completion: @escaping (ReportOutcome) -> Void
    ) {
        var backgroundTask: UIBackgroundTaskIdentifier = .invalid
        let finish = {
            guard backgroundTask != .invalid else { return }
            UIApplication.shared.endBackgroundTask(backgroundTask)
            backgroundTask = .invalid
        }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "GeofenceReport") {
            DispatchQueue.main.async(execute: finish)
        }

        var request = URLRequest(url: device.reportUrl)
        request.httpMethod = "POST"
        request.setValue("Bearer \(device.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try JSONEncoder().encode(ReportBody(fence: fenceId, on: transition))
        } catch {
            geofenceLog("Failed to encode report fence=\(fenceId)", level: .error)
            finish()
            return
        }

        geofenceLog("Reporting fence=\(fenceId) on=\(transition.rawValue)")
        let task = session.dataTask(with: request) { _, response, error in
            let outcome: ReportOutcome
            if let error {
                geofenceLog("Report failed fence=\(fenceId) error=\(error.localizedDescription)", level: .error)
                outcome = .failed
            } else if let http = response as? HTTPURLResponse {
                geofenceLog("Report answered fence=\(fenceId) httpStatus=\(http.statusCode)")
                switch http.statusCode {
                case 200 ..< 300: outcome = .accepted
                case 401: outcome = .unauthorized
                case 404: outcome = .fenceGone
                default: outcome = .failed
                }
            } else {
                outcome = .failed
            }

            DispatchQueue.main.async {
                completion(outcome)
                finish()
            }
        }
        task.resume()
    }
}
