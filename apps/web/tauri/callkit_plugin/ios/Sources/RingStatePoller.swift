import Foundation

/// Polls the backend ring-status endpoint while a CallKit incoming call is
/// ringing, so the ring can be ended when the user answers on another device
/// (answered elsewhere) or the call ends before anyone answers (remote ended).
///
/// All mutable state is main-thread only, matching the coordinator's
/// threading convention; URLSession completion handlers hop to main before
/// touching state. `onResolved` fires at most once and never after `cancel()`.
final class RingStatePoller {
    enum ResolvedStatus {
        case answered
        case ended
    }

    private struct StatusResponse: Decodable {
        let status: String
    }

    private let uuid: UUID
    private let url: URL
    private let bearerToken: String
    private let interval: TimeInterval
    private let window: TimeInterval
    private let onResolved: (UUID, ResolvedStatus) -> Void
    private let session: URLSession

    private var deadline: Date?
    private var pendingTick: DispatchWorkItem?
    private var isCancelled = false
    private var isResolved = false

    init(
        uuid: UUID,
        url: URL,
        bearerToken: String,
        interval: TimeInterval = 1.0,
        window: TimeInterval = 60.0,
        onResolved: @escaping (UUID, ResolvedStatus) -> Void
    ) {
        self.uuid = uuid
        self.url = url
        self.bearerToken = bearerToken
        self.interval = interval
        self.window = window
        self.onResolved = onResolved
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 5
        self.session = URLSession(configuration: config)
    }

    /// Main-thread only. Starts polling after one interval.
    func start() {
        guard deadline == nil, !isCancelled else { return }
        deadline = Date().addingTimeInterval(window)
        print("[CallKit] Ring-status polling started uuid=\(uuid.uuidString)")
        scheduleTick()
    }

    /// Main-thread only. Idempotent; `onResolved` never fires afterwards.
    func cancel() {
        guard !isCancelled else { return }
        isCancelled = true
        pendingTick?.cancel()
        pendingTick = nil
        session.invalidateAndCancel()
        print("[CallKit] Ring-status polling cancelled uuid=\(uuid.uuidString)")
    }

    private func scheduleTick() {
        guard !isCancelled, !isResolved else { return }
        guard let deadline, Date().addingTimeInterval(interval) <= deadline else {
            // Window expired: stop polling and leave the ring as-is.
            print("[CallKit] Ring-status polling window expired uuid=\(uuid.uuidString)")
            return
        }
        let work = DispatchWorkItem { [weak self] in
            self?.poll()
        }
        pendingTick = work
        DispatchQueue.main.asyncAfter(deadline: .now() + interval, execute: work)
    }

    private func poll() {
        guard !isCancelled, !isResolved else { return }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        let task = session.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                self?.handlePollResult(data: data, response: response, error: error)
            }
        }
        task.resume()
    }

    private func handlePollResult(data: Data?, response: URLResponse?, error: Error?) {
        guard !isCancelled, !isResolved else { return }

        if let error {
            print("[CallKit] Ring-status poll transient error uuid=\(uuid.uuidString) error=\(error.localizedDescription)")
            scheduleTick()
            return
        }

        guard let http = response as? HTTPURLResponse else {
            scheduleTick()
            return
        }

        switch http.statusCode {
        case 200:
            break
        case 401, 403, 404:
            // Invalid token or a backend without the endpoint — retrying
            // cannot succeed; stop and leave the ring as-is.
            print("[CallKit] Ring-status polling stopped uuid=\(uuid.uuidString) httpStatus=\(http.statusCode)")
            return
        default:
            print("[CallKit] Ring-status poll transient HTTP error uuid=\(uuid.uuidString) httpStatus=\(http.statusCode)")
            scheduleTick()
            return
        }

        guard let data,
              let decoded = try? JSONDecoder().decode(StatusResponse.self, from: data) else {
            print("[CallKit] Ring-status poll returned undecodable body uuid=\(uuid.uuidString)")
            scheduleTick()
            return
        }

        switch decoded.status {
        case "answered":
            resolve(.answered)
        case "ended":
            resolve(.ended)
        case "ringing":
            scheduleTick()
        default:
            print("[CallKit] Ring-status poll returned unknown status '\(decoded.status)' uuid=\(uuid.uuidString)")
            scheduleTick()
        }
    }

    private func resolve(_ status: ResolvedStatus) {
        guard !isCancelled, !isResolved else { return }
        isResolved = true
        pendingTick?.cancel()
        pendingTick = nil
        onResolved(uuid, status)
    }
}
