import UIKit
import WebKit

/// Runs the production overlay without authentication, a backend, or a call.
/// A physical device can use this same screen to stress the gesture lifecycle.
@main
final class HarnessApp: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private let overlay = CallVideoOverlayController()
    private var timer: Timer?
    private var ids = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank"]
    private var primary = "Alice"
    private var tick = 0
    private let status = UILabel()
    private var heldPrimary: String?
    private var heldRow: [String]?
    private var violations = 0

    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        let controller = UIViewController()
        let webview = WKWebView(frame: window.bounds)
        controller.view = webview
        window.rootViewController = controller
        self.window = window
        window.makeKeyAndVisible()
        overlay.attach(to: webview)
        overlay.setMode(.expanded)
        overlay.onSelectRemoteParticipant = { [weak self] id in
            guard let self else { return }
            self.primary = id
            self.publish()
        }
        publish()
        // Above the drawer, so stress controls remain available.
        let controls = UIStackView(frame: CGRect(x: 12, y: window.safeAreaInsets.top + 4, width: window.bounds.width - 24, height: 36))
        controls.distribution = .fillEqually
        for (title, action) in [("Speakers", #selector(startSpeakers)), ("Departures", #selector(startDepartures)), ("Stop", #selector(stop))] {
            let button = UIButton(type: .system)
            button.setTitle(title, for: .normal)
            button.addTarget(self, action: action, for: .touchUpInside)
            controls.addArrangedSubview(button)
        }
        status.frame = CGRect(x: 12, y: controls.frame.maxY, width: window.bounds.width - 24, height: 30)
        status.accessibilityIdentifier = "harness.status"
        status.text = "Ready"
        // Overlay is installed asynchronously. Add controls afterwards.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            let row = window.descendants.first { $0.accessibilityIdentifier == "call.participant-row" }
            let overlayRoot = row?.superview?.superview ?? window
            overlayRoot.addSubview(controls)
            overlayRoot.addSubview(self.status)
        }
        return true
    }

    private func publish() {
        overlay.setRemoteVideoParticipants(ids.map {
            NativeVideoParticipant(id: $0, title: $0, track: nil, isSpeaking: $0 == primary, isPinned: false, isScreenShare: false)
        }, primaryId: primary)
    }

    @objc private func startSpeakers() { start(departures: false) }
    @objc private func startDepartures() { start(departures: true) }
    @objc private func stop() {
        timer?.invalidate()
        timer = nil
        status.text = "Stopped; violations=\(violations)"
    }

    private func start(departures: Bool) {
        timer?.invalidate()
        tick = 0
        violations = 0
        heldPrimary = nil
        heldRow = nil
        timer = Timer(timeInterval: 0.08, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.auditPresentation()
            self.tick += 1
            self.ids = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank"]
            if departures, self.tick % 2 == 0 { self.ids.remove(at: (self.tick / 2) % self.ids.count) }
            self.primary = self.ids[self.tick % self.ids.count]
            self.publish()
            self.status.text = "Updates=\(self.tick); violations=\(self.violations)"
        }
        RunLoop.main.add(timer!, forMode: .common)
    }

    private func auditPresentation() {
        guard let window,
              let row = window.descendants.first(where: { $0.accessibilityIdentifier == "call.participant-row" }) as? UIScrollView,
              let label = window.descendants.first(where: { $0.accessibilityIdentifier == "call.primary-participant" }) as? UILabel else { return }
        let tiles = row.descendants.filter { $0.accessibilityIdentifier?.hasPrefix("call.participant.") == true }
            .sorted { $0.convert($0.bounds, to: row).minX < $1.convert($1.bounds, to: row).minX }
        let items = tiles.compactMap { $0.accessibilityIdentifier?.replacingOccurrences(of: "call.participant.", with: "") }
        if items.contains(label.text ?? "") { violations += 1 }
        if row.isTracking || row.isDragging || row.isDecelerating {
            if let heldPrimary, heldPrimary != label.text { violations += 1 }
            if let heldRow, heldRow != items { violations += 1 }
            heldPrimary = label.text
            heldRow = items
        } else {
            heldPrimary = nil
            heldRow = nil
        }
    }
}

extension UIView {
    var descendants: [UIView] { subviews.flatMap { [$0] + $0.descendants } }
}
