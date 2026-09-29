import Foundation
import UIKit

/// Tells the backend that the user declined a ringing CallKit call on this
/// device, so their other devices stop ringing (`call_declined` over the
/// websocket, `declined` from the ring-status poll). Authorized with the same
/// VoIP-delivered LiveKit token the ring-status poller uses; the decline URL
/// is the ring-status URL plus `/decline`.
///
/// A lock-screen decline usually suspends the app right after CallKit ends
/// the call, so the request runs under a background task. It is
/// fire-and-forget: a failure only leaves the other devices ringing until
/// their own timeout.
enum RingDeclineReporter {
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 5
        return URLSession(configuration: config)
    }()

    static func declineUrl(fromRingStatusUrl ringStatusUrl: String) -> URL? {
        guard var components = URLComponents(string: ringStatusUrl) else { return nil }
        let base = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = base + "/decline"
        return components.url
    }

    static func report(uuid: UUID, ringStatusUrl: String, bearerToken: String) {
        guard let url = declineUrl(fromRingStatusUrl: ringStatusUrl) else {
            print("[CallKit] Invalid ringStatusUrl for decline uuid=\(uuid.uuidString)")
            return
        }

        var backgroundTask: UIBackgroundTaskIdentifier = .invalid
        let finish = {
            guard backgroundTask != .invalid else { return }
            UIApplication.shared.endBackgroundTask(backgroundTask)
            backgroundTask = .invalid
        }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "CallKitReportDecline") {
            DispatchQueue.main.async(execute: finish)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        print("[CallKit] Reporting decline uuid=\(uuid.uuidString)")
        let task = session.dataTask(with: request) { _, response, error in
            if let error {
                print("[CallKit] Decline report failed uuid=\(uuid.uuidString) error=\(error.localizedDescription)")
            } else if let http = response as? HTTPURLResponse, !(200 ..< 300).contains(http.statusCode) {
                // 404 means the call already ended or was replaced; nothing left to decline.
                print("[CallKit] Decline report rejected uuid=\(uuid.uuidString) httpStatus=\(http.statusCode)")
            } else {
                print("[CallKit] Decline reported uuid=\(uuid.uuidString)")
            }
            DispatchQueue.main.async(execute: finish)
        }
        task.resume()
    }
}
