import LiveKit
import UIKit
import WebKit

enum CallVideoOverlayMode: String {
    case hidden
    case expanded
    case minimized
}

/// Native video surface that floats above the Tauri WKWebView.
final class CallVideoOverlayController: NSObject, @unchecked Sendable {
    private let rootView = PassthroughOverlayView()
    private let drawerView = UIView()
    private let drawerHandle = UIView()
    private let primaryVideoView = VideoView()
    private let localPreviewView = VideoView()
    private let controlsView = UIStackView()
    private let microphoneButton = UIButton(type: .system)
    private let cameraButton = UIButton(type: .system)
    private let switchCameraButton = UIButton(type: .system)
    private let endCallButton = UIButton(type: .system)
    private let thumbnailView = UIView()
    private let thumbnailVideoView = VideoView()
    private let edgeTabView = UILabel()

    var onToggleMicrophone: (() -> Void)?
    var onToggleCamera: (() -> Void)?
    var onSwitchCamera: (() -> Void)?
    var onEndCall: (() -> Void)?

    private var mode: CallVideoOverlayMode = .hidden
    private var thumbnailCorner: ThumbnailCorner = .topRight
    private var didAutoPresent = false
    private var isAudioMuted = false
    private var isLocalVideoEnabled = false
    private weak var webview: WKWebView?

    override init() {
        super.init()
        configureViews()
    }

    func attach(to webview: WKWebView) {
        DispatchQueue.main.async { [weak self, weak webview] in
            guard let self, let webview else { return }
            self.webview = webview
            self.attachToBestAvailableParent()
            self.layoutOverlay()
        }
    }

    func setMode(_ mode: CallVideoOverlayMode) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.mode = mode
            self.attachToBestAvailableParent()
            self.rootView.superview?.bringSubviewToFront(self.rootView)
            self.layoutOverlay()
            print("[CallKit] Native video overlay mode=\(mode.rawValue)")
        }
    }

    func presentForActiveCallIfNeeded() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.attachToBestAvailableParent()
            guard self.mode == .hidden, !self.didAutoPresent else { return }
            self.didAutoPresent = true
            self.mode = .expanded
            self.rootView.superview?.bringSubviewToFront(self.rootView)
            self.layoutOverlay()
            print("[CallKit] Native video overlay auto-presented for active call")
        }
    }

    func setRemoteVideoTrack(_ track: VideoTrack?) {
        DispatchQueue.main.async { [weak self, weak track] in
            guard let self else { return }
            self.attachToBestAvailableParent()
            self.primaryVideoView.track = track
            self.thumbnailVideoView.track = track
            if track != nil, self.mode == .hidden, !self.didAutoPresent {
                self.didAutoPresent = true
                self.mode = .expanded
            }
            self.rootView.superview?.bringSubviewToFront(self.rootView)
            self.layoutOverlay()
            print("[CallKit] Native video overlay remoteTrack=\(track == nil ? "nil" : "set")")
        }
    }

    func setLocalVideoTrack(_ track: VideoTrack?) {
        DispatchQueue.main.async { [weak self, weak track] in
            guard let self else { return }
            self.attachToBestAvailableParent()
            self.localPreviewView.track = track
            self.setLocalVideoEnabled(track != nil)
            if track != nil, self.mode == .hidden, !self.didAutoPresent {
                self.didAutoPresent = true
                self.mode = .expanded
            }
            self.rootView.superview?.bringSubviewToFront(self.rootView)
            self.layoutOverlay()
            print("[CallKit] Native video overlay localTrack=\(track == nil ? "nil" : "set")")
        }
    }

    func setLocalVideoEnabled(_ enabled: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.isLocalVideoEnabled = enabled
            self.configureControlState()
            self.layoutOverlay()
            print("[CallKit] Native video overlay localVideoEnabled=\(enabled)")
        }
    }

    func setAudioMuted(_ muted: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.isAudioMuted = muted
            self.configureControlState()
            self.layoutOverlay()
            print("[CallKit] Native video overlay audioMuted=\(muted)")
        }
    }

    func reset() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.primaryVideoView.track = nil
            self.thumbnailVideoView.track = nil
            self.localPreviewView.track = nil
            self.isAudioMuted = false
            self.isLocalVideoEnabled = false
            self.mode = .hidden
            self.didAutoPresent = false
            self.configureControlState()
            self.layoutOverlay()
            print("[CallKit] Native video overlay reset")
        }
    }

    private func attachToBestAvailableParent() {
        guard let webview else { return }
        let parent = webview.window ?? webview.superview ?? webview
        if rootView.superview !== parent {
            rootView.removeFromSuperview()
            rootView.frame = parent.bounds
            rootView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            parent.addSubview(rootView)
            print("[CallKit] Attached native video overlay parent=\(type(of: parent)) frame=\(parent.bounds)")
        } else {
            rootView.frame = parent.bounds
        }
    }

    private func configureViews() {
        rootView.backgroundColor = .clear
        rootView.onLayout = { [weak self] in self?.layoutOverlay() }

        drawerView.backgroundColor = UIColor.black.withAlphaComponent(0.94)
        drawerView.layer.cornerRadius = 18
        drawerView.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        drawerView.clipsToBounds = true
        rootView.addSubview(drawerView)

        drawerHandle.backgroundColor = UIColor.white.withAlphaComponent(0.38)
        drawerHandle.layer.cornerRadius = 2
        drawerView.addSubview(drawerHandle)

        primaryVideoView.layoutMode = .fill
        primaryVideoView.backgroundColor = .black
        drawerView.addSubview(primaryVideoView)

        localPreviewView.layoutMode = .fill
        localPreviewView.mirrorMode = .auto
        localPreviewView.backgroundColor = UIColor(white: 0.08, alpha: 1)
        localPreviewView.layer.cornerRadius = 10
        localPreviewView.clipsToBounds = true
        drawerView.addSubview(localPreviewView)

        controlsView.axis = .horizontal
        controlsView.alignment = .center
        controlsView.distribution = .fill
        controlsView.spacing = 14
        drawerView.addSubview(controlsView)

        configureControlButton(microphoneButton, systemImageName: "mic.fill", action: #selector(toggleMicrophone))
        configureControlButton(cameraButton, systemImageName: "video.slash.fill", action: #selector(toggleCamera))
        configureControlButton(switchCameraButton, systemImageName: "camera.rotate.fill", action: #selector(switchCamera))
        configureControlButton(endCallButton, systemImageName: "phone.down.fill", action: #selector(endCall))
        controlsView.addArrangedSubview(microphoneButton)
        controlsView.addArrangedSubview(cameraButton)
        controlsView.addArrangedSubview(switchCameraButton)
        controlsView.addArrangedSubview(endCallButton)
        configureControlState()

        let minimizeTap = UITapGestureRecognizer(target: self, action: #selector(minimizeFromDrawer))
        drawerHandle.addGestureRecognizer(minimizeTap)
        drawerHandle.isUserInteractionEnabled = true

        thumbnailView.backgroundColor = .black
        thumbnailView.layer.cornerRadius = 12
        thumbnailView.layer.borderColor = UIColor.white.withAlphaComponent(0.22).cgColor
        thumbnailView.layer.borderWidth = 1
        thumbnailView.clipsToBounds = true
        rootView.addSubview(thumbnailView)

        thumbnailVideoView.layoutMode = .fill
        thumbnailVideoView.backgroundColor = .black
        thumbnailView.addSubview(thumbnailVideoView)

        let thumbnailTap = UITapGestureRecognizer(target: self, action: #selector(expandFromThumbnail))
        thumbnailView.addGestureRecognizer(thumbnailTap)
        let thumbnailPan = UIPanGestureRecognizer(target: self, action: #selector(dragThumbnail(_:)))
        thumbnailView.addGestureRecognizer(thumbnailPan)

        edgeTabView.backgroundColor = UIColor.black.withAlphaComponent(0.86)
        edgeTabView.textColor = .white
        edgeTabView.textAlignment = .center
        edgeTabView.font = .boldSystemFont(ofSize: 18)
        edgeTabView.layer.cornerRadius = 10
        edgeTabView.clipsToBounds = true
        edgeTabView.isUserInteractionEnabled = true
        edgeTabView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(showThumbnailFromEdge)))
        rootView.addSubview(edgeTabView)
    }

    private func configureControlButton(_ button: UIButton, systemImageName: String, action: Selector) {
        button.tintColor = .white
        button.backgroundColor = UIColor.white.withAlphaComponent(0.16)
        button.layer.cornerRadius = 24
        button.clipsToBounds = true
        button.setImage(UIImage(systemName: systemImageName), for: .normal)
        button.addTarget(self, action: action, for: .touchUpInside)
        button.widthAnchor.constraint(equalToConstant: 48).isActive = true
        button.heightAnchor.constraint(equalToConstant: 48).isActive = true
    }

    private func configureControlState() {
        let microphoneImage = isAudioMuted ? "mic.slash.fill" : "mic.fill"
        microphoneButton.setImage(UIImage(systemName: microphoneImage), for: .normal)
        microphoneButton.backgroundColor = isAudioMuted
            ? UIColor.systemRed.withAlphaComponent(0.86)
            : UIColor.white.withAlphaComponent(0.16)

        let cameraImage = isLocalVideoEnabled ? "video.fill" : "video.slash.fill"
        cameraButton.setImage(UIImage(systemName: cameraImage), for: .normal)
        cameraButton.backgroundColor = isLocalVideoEnabled
            ? UIColor.white.withAlphaComponent(0.16)
            : UIColor.systemRed.withAlphaComponent(0.86)
        switchCameraButton.isHidden = !isLocalVideoEnabled
        endCallButton.backgroundColor = UIColor.systemRed.withAlphaComponent(0.92)
        localPreviewView.isHidden = !isLocalVideoEnabled
    }

    private func layoutOverlay() {
        let bounds = rootView.bounds
        guard !bounds.isEmpty else { return }

        drawerView.isHidden = mode != .expanded
        thumbnailView.isHidden = mode != .minimized
        edgeTabView.isHidden = mode != .hidden || primaryVideoView.track == nil

        let drawerHeight = min(max(bounds.height * 0.8, 320), bounds.height - 72)
        drawerView.frame = CGRect(x: 0, y: bounds.height - drawerHeight, width: bounds.width, height: drawerHeight)
        drawerHandle.frame = CGRect(x: (drawerView.bounds.width - 42) / 2, y: 10, width: 42, height: 4)
        primaryVideoView.frame = CGRect(x: 0, y: 24, width: drawerView.bounds.width, height: drawerView.bounds.height - 24)
        let previewWidth: CGFloat = min(128, drawerView.bounds.width * 0.28)
        localPreviewView.frame = CGRect(
            x: drawerView.bounds.width - previewWidth - 16,
            y: drawerView.bounds.height - (previewWidth * 1.35) - 84,
            width: previewWidth,
            height: previewWidth * 1.35
        )
        let controlsSize = controlsView.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
        controlsView.frame = CGRect(
            x: (drawerView.bounds.width - controlsSize.width) / 2,
            y: drawerView.bounds.height - controlsSize.height - 20,
            width: controlsSize.width,
            height: controlsSize.height
        )

        let thumbnailSize = CGSize(width: 160, height: 96)
        if thumbnailView.frame == .zero || !bounds.insetBy(dx: -40, dy: -40).contains(thumbnailView.center) {
            thumbnailView.frame = thumbnailFrame(for: thumbnailCorner, size: thumbnailSize, in: bounds, safeAreaInsets: rootView.safeAreaInsets)
        }
        thumbnailVideoView.frame = thumbnailView.bounds

        edgeTabView.frame = CGRect(x: bounds.width - 34, y: bounds.midY - 36, width: 34, height: 72)
        edgeTabView.text = "‹"
    }

    private func thumbnailFrame(
        for corner: ThumbnailCorner,
        size: CGSize,
        in bounds: CGRect,
        safeAreaInsets: UIEdgeInsets
    ) -> CGRect {
        let margin: CGFloat = 16
        let top = safeAreaInsets.top + margin
        let bottom = bounds.height - safeAreaInsets.bottom - margin - size.height
        let left = margin
        let right = bounds.width - margin - size.width

        switch corner {
        case .topLeft: return CGRect(origin: CGPoint(x: left, y: top), size: size)
        case .topRight: return CGRect(origin: CGPoint(x: right, y: top), size: size)
        case .bottomLeft: return CGRect(origin: CGPoint(x: left, y: bottom), size: size)
        case .bottomRight: return CGRect(origin: CGPoint(x: right, y: bottom), size: size)
        }
    }

    private func nearestCorner(to center: CGPoint, in bounds: CGRect) -> ThumbnailCorner {
        let left = center.x < bounds.midX
        let top = center.y < bounds.midY
        switch (left, top) {
        case (true, true): return .topLeft
        case (false, true): return .topRight
        case (true, false): return .bottomLeft
        case (false, false): return .bottomRight
        }
    }

    @objc private func minimizeFromDrawer() {
        setMode(.minimized)
    }

    @objc private func expandFromThumbnail() {
        setMode(.expanded)
    }

    @objc private func showThumbnailFromEdge() {
        setMode(.minimized)
    }

    @objc private func toggleMicrophone() {
        print("[CallKit] Native video overlay microphone toggle tapped currentMuted=\(isAudioMuted)")
        onToggleMicrophone?()
    }

    @objc private func toggleCamera() {
        print("[CallKit] Native video overlay camera toggle tapped currentEnabled=\(isLocalVideoEnabled)")
        onToggleCamera?()
    }

    @objc private func switchCamera() {
        print("[CallKit] Native video overlay camera switch tapped")
        onSwitchCamera?()
    }

    @objc private func endCall() {
        print("[CallKit] Native video overlay end call tapped")
        onEndCall?()
    }

    @objc private func dragThumbnail(_ recognizer: UIPanGestureRecognizer) {
        let translation = recognizer.translation(in: rootView)
        recognizer.setTranslation(.zero, in: rootView)
        thumbnailView.center = CGPoint(
            x: thumbnailView.center.x + translation.x,
            y: thumbnailView.center.y + translation.y
        )

        guard recognizer.state == .ended || recognizer.state == .cancelled else { return }

        let bounds = rootView.bounds
        if thumbnailView.center.x > bounds.width + 24 || thumbnailView.center.x < -24 {
            mode = .hidden
            layoutOverlay()
            return
        }

        thumbnailCorner = nearestCorner(to: thumbnailView.center, in: bounds)
        UIView.animate(withDuration: 0.2, delay: 0, options: [.curveEaseOut]) {
            self.thumbnailView.frame = self.thumbnailFrame(
                for: self.thumbnailCorner,
                size: self.thumbnailView.bounds.size,
                in: bounds,
                safeAreaInsets: self.rootView.safeAreaInsets
            )
        }
    }
}

private enum ThumbnailCorner {
    case topLeft
    case topRight
    case bottomLeft
    case bottomRight
}

private final class PassthroughOverlayView: UIView {
    var onLayout: (() -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?()
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }
}
