import LiveKit
import UIKit
import WebKit

enum CallVideoOverlayMode: String {
    case hidden
    case expanded
    case minimized
}

struct NativeVideoParticipant {
    let id: String
    let title: String
    let track: VideoTrack?
    let isSpeaking: Bool
    let isPinned: Bool
    let isScreenShare: Bool
}

/// Native video surface that floats above the Tauri WKWebView.
final class CallVideoOverlayController: NSObject, UIGestureRecognizerDelegate, @unchecked Sendable {
    private let rootView = PassthroughOverlayView()
    private let drawerView = UIView()
    private let drawerHandle = UIView()
    private let channelTitleLabel = UILabel()
    private let leaveButton = UIButton(type: .system)
    private let primaryVideoView = VideoView()
    private let primaryPlaceholderView = UIView()
    private let primaryInitialsLabel = UILabel()
    private let primaryParticipantLabel = UILabel()
    private let stripScrollView = UIScrollView()
    private let stripStackView = UIStackView()
    private let localPreviewView = VideoView()
    private let controlsView = UIStackView()
    private let microphoneButton = UIButton(type: .system)
    private let cameraButton = UIButton(type: .system)
    private let switchCameraButton = UIButton(type: .system)
    private let thumbnailView = UIView()
    private let thumbnailLocalVideoView = VideoView()
    private let thumbnailRemoteVideoView = VideoView()
    private let thumbnailDividerView = UIView()
    private let edgeTabView = UILabel()

    var onToggleMicrophone: (() -> Void)?
    var onToggleCamera: (() -> Void)?
    var onSwitchCamera: (() -> Void)?
    var onEndCall: (() -> Void)?
    var onSelectRemoteParticipant: ((String) -> Void)?
    var onOpenDrawerFromThumbnail: (() -> Void)?

    private var mode: CallVideoOverlayMode = .hidden
    private var thumbnailCorner: ThumbnailCorner = .topRight
    private var didAutoPresent = false
    private var isAudioMuted = false
    private var isLocalVideoEnabled = false
    private var channelTitle = "Call"
    private var localVideoTrack: VideoTrack?
    private var renderedLocalPreviewTrack: VideoTrack?
    private var remoteVideoParticipants: [NativeVideoParticipant] = []
    private var primaryRemoteParticipantId: String?
    private var primaryRemoteParticipantTitle: String?
    private var primaryRemoteVideoTrack: VideoTrack?
    private var renderedThumbnailLocalVideoTrack: VideoTrack?
    private var renderedThumbnailRemoteVideoTrack: VideoTrack?
    private var stripTileViews: [String: RemoteVideoTileView] = [:]
    private var drawerPanStartFrame: CGRect = .zero
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
            self.updateVideoRenderTargets()
            self.layoutOverlay()
            print("[CallKit] Native video overlay mode=\(mode.rawValue)")
        }
    }

    func setChannelTitle(_ title: String?) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let trimmedTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let trimmedTitle, !trimmedTitle.isEmpty {
                self.channelTitle = trimmedTitle
            } else {
                self.channelTitle = "Call"
            }
            self.channelTitleLabel.text = self.channelTitle
            self.layoutOverlay()
            print("[CallKit] Native video overlay channelTitle=\(self.channelTitle)")
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
            self.remoteVideoParticipants = []
            self.primaryRemoteParticipantId = nil
            self.primaryRemoteParticipantTitle = nil
            self.primaryRemoteVideoTrack = track
            self.rebuildParticipantStrip()
            self.primaryVideoView.track = track
            self.updateVideoRenderTargets()
            if track != nil, self.mode == .hidden, !self.didAutoPresent {
                self.didAutoPresent = true
                self.mode = .expanded
                self.updateVideoRenderTargets()
            }
            self.rootView.superview?.bringSubviewToFront(self.rootView)
            self.layoutOverlay()
            print("[CallKit] Native video overlay remoteTrack=\(track == nil ? "nil" : "set")")
        }
    }

    func setRemoteVideoParticipants(_ participants: [NativeVideoParticipant], primaryId: String?) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.attachToBestAvailableParent()
            self.remoteVideoParticipants = participants
            self.primaryRemoteParticipantId = primaryId

            let primary = participants.first(where: { $0.id == primaryId }) ?? participants.first
            self.primaryRemoteVideoTrack = primary?.track
            self.primaryRemoteParticipantTitle = primary.map { $0.isScreenShare ? "Screen" : $0.title }
            self.primaryVideoView.track = primary?.track
            self.updateVideoRenderTargets()
            self.rebuildParticipantStrip()

            if primary != nil, self.mode == .hidden, !self.didAutoPresent {
                self.didAutoPresent = true
                self.mode = .expanded
                self.updateVideoRenderTargets()
            }

            self.rootView.superview?.bringSubviewToFront(self.rootView)
            self.layoutOverlay()
            print("[CallKit] Native video overlay remoteParticipants=\(participants.count) primary=\(primary?.id ?? "nil")")
        }
    }

    func setLocalVideoTrack(_ track: VideoTrack?) {
        DispatchQueue.main.async { [weak self, weak track] in
            guard let self else { return }
            self.attachToBestAvailableParent()
            self.localVideoTrack = track
            self.updateVideoRenderTargets()
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
            self.thumbnailLocalVideoView.track = nil
            self.thumbnailRemoteVideoView.track = nil
            self.localPreviewView.track = nil
            self.localVideoTrack = nil
            self.renderedLocalPreviewTrack = nil
            self.remoteVideoParticipants = []
            self.primaryRemoteParticipantId = nil
            self.primaryRemoteParticipantTitle = nil
            self.primaryRemoteVideoTrack = nil
            self.renderedThumbnailLocalVideoTrack = nil
            self.renderedThumbnailRemoteVideoTrack = nil
            self.rebuildParticipantStrip()
            self.isAudioMuted = false
            self.isLocalVideoEnabled = false
            self.mode = .hidden
            self.didAutoPresent = false
            self.channelTitle = "Call"
            self.channelTitleLabel.text = self.channelTitle
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

        let drawerPan = UIPanGestureRecognizer(target: self, action: #selector(dragDrawer(_:)))
        drawerPan.delegate = self
        drawerPan.cancelsTouchesInView = false
        drawerView.addGestureRecognizer(drawerPan)

        drawerHandle.backgroundColor = UIColor.white.withAlphaComponent(0.38)
        drawerHandle.layer.cornerRadius = 2
        drawerView.addSubview(drawerHandle)

        channelTitleLabel.text = channelTitle
        channelTitleLabel.textColor = .white
        channelTitleLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        channelTitleLabel.lineBreakMode = .byTruncatingTail
        drawerView.addSubview(channelTitleLabel)

        leaveButton.tintColor = .white
        leaveButton.backgroundColor = UIColor.systemRed.withAlphaComponent(0.92)
        leaveButton.layer.cornerRadius = 16
        leaveButton.clipsToBounds = true
        leaveButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        leaveButton.setTitle("Leave", for: .normal)
        leaveButton.addTarget(self, action: #selector(endCall), for: .touchUpInside)
        drawerView.addSubview(leaveButton)

        primaryVideoView.layoutMode = .fill
        primaryVideoView.backgroundColor = .black
        drawerView.addSubview(primaryVideoView)

        primaryPlaceholderView.backgroundColor = UIColor(white: 0.06, alpha: 1)
        drawerView.addSubview(primaryPlaceholderView)

        primaryInitialsLabel.textColor = .white
        primaryInitialsLabel.textAlignment = .center
        primaryInitialsLabel.font = .systemFont(ofSize: 34, weight: .semibold)
        primaryInitialsLabel.backgroundColor = UIColor.white.withAlphaComponent(0.16)
        primaryInitialsLabel.layer.cornerRadius = 38
        primaryInitialsLabel.clipsToBounds = true
        primaryPlaceholderView.addSubview(primaryInitialsLabel)

        primaryParticipantLabel.textColor = .white
        primaryParticipantLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        primaryParticipantLabel.lineBreakMode = .byTruncatingTail
        primaryParticipantLabel.backgroundColor = UIColor.black.withAlphaComponent(0.48)
        primaryParticipantLabel.textAlignment = .left
        primaryParticipantLabel.layer.cornerRadius = 12
        primaryParticipantLabel.clipsToBounds = true
        drawerView.addSubview(primaryParticipantLabel)

        stripScrollView.showsHorizontalScrollIndicator = false
        stripScrollView.alwaysBounceHorizontal = true
        stripScrollView.backgroundColor = .clear
        drawerView.addSubview(stripScrollView)

        stripStackView.axis = .horizontal
        stripStackView.alignment = .fill
        stripStackView.distribution = .fill
        stripStackView.spacing = 10
        stripScrollView.addSubview(stripStackView)

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
        controlsView.addArrangedSubview(microphoneButton)
        controlsView.addArrangedSubview(cameraButton)
        controlsView.addArrangedSubview(switchCameraButton)
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

        thumbnailLocalVideoView.layoutMode = .fill
        thumbnailLocalVideoView.mirrorMode = .auto
        thumbnailLocalVideoView.backgroundColor = UIColor(white: 0.06, alpha: 1)
        thumbnailView.addSubview(thumbnailLocalVideoView)

        thumbnailRemoteVideoView.layoutMode = .fill
        thumbnailRemoteVideoView.backgroundColor = .black
        thumbnailView.addSubview(thumbnailRemoteVideoView)

        thumbnailDividerView.backgroundColor = UIColor.white.withAlphaComponent(0.18)
        thumbnailView.addSubview(thumbnailDividerView)

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
        localPreviewView.isHidden = !isLocalVideoEnabled
    }

    private func rebuildParticipantStrip() {
        UIView.performWithoutAnimation {
            let participants = stripParticipants
            let activeIds = Set(participants.map(\.id))
            let staleIds = stripTileViews.keys.filter { !activeIds.contains($0) }
            for id in staleIds {
                guard let tile = stripTileViews.removeValue(forKey: id) else { continue }
                tile.prepareForRemoval()
                stripStackView.removeArrangedSubview(tile)
                tile.removeFromSuperview()
            }

            stripStackView.arrangedSubviews.forEach { view in
                stripStackView.removeArrangedSubview(view)
                view.removeFromSuperview()
            }

            for participant in participants {
                let tile = stripTileViews[participant.id] ?? RemoteVideoTileView()
                stripTileViews[participant.id] = tile
                tile.configure(participant: participant, isPrimary: participant.id == primaryRemoteParticipantId)
                tile.onTap = { [weak self] id in
                    print("[CallKit] Native video overlay remote tile tapped id=\(id)")
                    self?.onSelectRemoteParticipant?(id)
                }
                tile.ensureFixedSize()
                stripStackView.addArrangedSubview(tile)
            }
        }
    }

    private var stripParticipants: [NativeVideoParticipant] {
        remoteVideoParticipants.filter { $0.id != primaryRemoteParticipantId }
    }

    private func updateVideoRenderTargets() {
        updateLocalPreviewTrack()
        updateThumbnailTracks()
    }

    private func updateLocalPreviewTrack() {
        let desiredTrack = mode == .expanded ? localVideoTrack : nil
        guard renderedLocalPreviewTrack !== desiredTrack else { return }
        renderedLocalPreviewTrack = desiredTrack
        localPreviewView.track = desiredTrack
    }

    private func updateThumbnailTracks() {
        let desiredLocalTrack = mode == .minimized ? localVideoTrack : nil
        if renderedThumbnailLocalVideoTrack !== desiredLocalTrack {
            renderedThumbnailLocalVideoTrack = desiredLocalTrack
            thumbnailLocalVideoView.track = desiredLocalTrack
        }

        let desiredRemoteTrack = mode == .minimized ? primaryRemoteVideoTrack : nil
        if renderedThumbnailRemoteVideoTrack !== desiredRemoteTrack {
            renderedThumbnailRemoteVideoTrack = desiredRemoteTrack
            thumbnailRemoteVideoView.track = desiredRemoteTrack
        }
    }

    private func layoutOverlay() {
        let bounds = rootView.bounds
        guard !bounds.isEmpty else { return }

        drawerView.isHidden = mode != .expanded
        thumbnailView.isHidden = mode != .minimized
        edgeTabView.isHidden = mode != .hidden || primaryRemoteParticipantTitle == nil
        rootView.blocksBackgroundTouches = mode == .expanded

        drawerView.frame = drawerFrame(in: bounds)
        drawerHandle.frame = CGRect(x: (drawerView.bounds.width - 42) / 2, y: 10, width: 42, height: 4)
        leaveButton.frame = CGRect(x: drawerView.bounds.width - 80, y: 18, width: 64, height: 32)
        channelTitleLabel.frame = CGRect(
            x: 16,
            y: 18,
            width: max(0, leaveButton.frame.minX - 28),
            height: 32
        )
        updateVideoRenderTargets()

        let stripParticipantCount = stripParticipants.count
        let stripHeight: CGFloat = stripParticipantCount > 0 ? 92 : 0
        let controlsSize = controlsView.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
        let controlsTop = drawerView.bounds.height - controlsSize.height - 20
        let stripTop = controlsTop - stripHeight - (stripHeight > 0 ? 14 : 0)
        primaryVideoView.frame = CGRect(
            x: 0,
            y: 62,
            width: drawerView.bounds.width,
            height: max(0, stripTop - 62)
        )
        let primaryHasParticipant = primaryRemoteParticipantTitle != nil
        let primaryHasVideo = primaryRemoteVideoTrack != nil
        primaryPlaceholderView.frame = primaryVideoView.frame
        primaryPlaceholderView.isHidden = !primaryHasParticipant || primaryHasVideo
        primaryInitialsLabel.text = primaryRemoteParticipantTitle.map(initials)
        primaryInitialsLabel.frame = CGRect(
            x: (primaryPlaceholderView.bounds.width - 76) / 2,
            y: (primaryPlaceholderView.bounds.height - 76) / 2,
            width: 76,
            height: 76
        )
        primaryParticipantLabel.text = primaryRemoteParticipantTitle.map { "  \($0)  " }
        primaryParticipantLabel.isHidden = primaryRemoteParticipantTitle == nil
        primaryParticipantLabel.frame = CGRect(
            x: 14,
            y: primaryVideoView.frame.maxY - 42,
            width: min(220, max(0, drawerView.bounds.width - 28)),
            height: 28
        )

        stripScrollView.isHidden = stripHeight == 0
        stripScrollView.frame = CGRect(
            x: 0,
            y: stripTop,
            width: drawerView.bounds.width,
            height: stripHeight
        )
        stripStackView.frame = CGRect(
            x: 16,
            y: 0,
            width: CGFloat(stripParticipantCount) * 128 + CGFloat(max(stripParticipantCount - 1, 0)) * 10,
            height: stripHeight
        )
        stripScrollView.contentSize = CGSize(width: stripStackView.frame.maxX + 16, height: stripHeight)
        stripStackView.arrangedSubviews.forEach { $0.frame.size = CGSize(width: 128, height: stripHeight) }

        let previewWidth: CGFloat = min(128, drawerView.bounds.width * 0.28)
        localPreviewView.frame = CGRect(
            x: drawerView.bounds.width - previewWidth - 16,
            y: max(40, primaryVideoView.frame.maxY - (previewWidth * 1.35) - 16),
            width: previewWidth,
            height: previewWidth * 1.35
        )
        controlsView.frame = CGRect(
            x: (drawerView.bounds.width - controlsSize.width) / 2,
            y: drawerView.bounds.height - controlsSize.height - 20,
            width: controlsSize.width,
            height: controlsSize.height
        )

        let thumbnailSize = CGSize(width: 160, height: 112)
        if thumbnailView.frame == .zero
            || thumbnailView.bounds.size != thumbnailSize
            || !bounds.insetBy(dx: -40, dy: -40).contains(thumbnailView.center) {
            thumbnailView.frame = thumbnailFrame(for: thumbnailCorner, size: thumbnailSize, in: bounds, safeAreaInsets: rootView.safeAreaInsets)
        }
        let thumbnailHalfWidth = thumbnailView.bounds.width / 2
        thumbnailLocalVideoView.frame = CGRect(x: 0, y: 0, width: thumbnailHalfWidth, height: thumbnailView.bounds.height)
        thumbnailRemoteVideoView.frame = CGRect(
            x: thumbnailHalfWidth,
            y: 0,
            width: thumbnailView.bounds.width - thumbnailHalfWidth,
            height: thumbnailView.bounds.height
        )
        thumbnailDividerView.frame = CGRect(x: thumbnailHalfWidth - 0.5, y: 0, width: 1, height: thumbnailView.bounds.height)

        edgeTabView.frame = CGRect(x: bounds.width - 34, y: bounds.midY - 36, width: 34, height: 72)
        edgeTabView.text = "‹"
    }

    private func initials(from title: String) -> String {
        let words = title
            .split { $0.isWhitespace || $0 == "@" || $0 == "." || $0 == "|" }
            .map(String.init)
            .filter { !$0.isEmpty && $0.lowercased() != "macro" }
        if words.count >= 2 {
            return "\(words[0].prefix(1))\(words[1].prefix(1))".uppercased()
        }
        if let first = words.first {
            return String(first.prefix(1)).uppercased()
        }
        return "?"
    }

    private func thumbnailFrame(
        for corner: ThumbnailCorner,
        size: CGSize,
        in bounds: CGRect,
        safeAreaInsets: UIEdgeInsets
    ) -> CGRect {
        let margin: CGFloat = 8
        let bottomOffset: CGFloat = 88
        let top = safeAreaInsets.top
        let bottom = bounds.height - safeAreaInsets.bottom - margin - size.height - bottomOffset
        let left = margin
        let right = bounds.width - margin - size.width

        switch corner {
        case .topLeft: return CGRect(origin: CGPoint(x: left, y: top), size: size)
        case .topRight: return CGRect(origin: CGPoint(x: right, y: top), size: size)
        case .bottomLeft: return CGRect(origin: CGPoint(x: left, y: bottom), size: size)
        case .bottomRight: return CGRect(origin: CGPoint(x: right, y: bottom), size: size)
        }
    }

    private func drawerFrame(in bounds: CGRect) -> CGRect {
        let drawerHeight = min(max(bounds.height * 0.8, 320), bounds.height - 72)
        return CGRect(x: 0, y: bounds.height - drawerHeight, width: bounds.width, height: drawerHeight)
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
        minimizeDrawerToThumbnail()
    }

    @objc private func expandFromThumbnail() {
        onOpenDrawerFromThumbnail?()
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

    @objc private func dragDrawer(_ recognizer: UIPanGestureRecognizer) {
        guard mode == .expanded else { return }

        switch recognizer.state {
        case .began:
            drawerPanStartFrame = drawerView.frame
        case .changed:
            let translation = recognizer.translation(in: rootView)
            let offset = max(0, translation.y)
            drawerView.frame = drawerPanStartFrame.offsetBy(dx: 0, dy: offset)
        case .ended, .cancelled, .failed:
            let translation = recognizer.translation(in: rootView)
            let velocity = recognizer.velocity(in: rootView)
            let shouldMinimize = translation.y > 96 || velocity.y > 700
            if shouldMinimize {
                minimizeDrawerToThumbnail()
            } else {
                UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseOut]) {
                    self.drawerView.frame = self.drawerFrame(in: self.rootView.bounds)
                }
            }
        default:
            break
        }
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

    private func minimizeDrawerToThumbnail() {
        thumbnailCorner = .topRight
        thumbnailView.frame = .zero
        setMode(.minimized)
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer.view === drawerView,
              let pan = gestureRecognizer as? UIPanGestureRecognizer else {
            return true
        }

        let velocity = pan.velocity(in: drawerView)
        return abs(velocity.y) > abs(velocity.x) && velocity.y > 0
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard gestureRecognizer.view === drawerView else { return true }
        return !(touch.view is UIControl)
    }
}

private enum ThumbnailCorner {
    case topLeft
    case topRight
    case bottomLeft
    case bottomRight
}

private final class RemoteVideoTileView: UIControl {
    private let videoView = VideoView()
    private let placeholderView = UIView()
    private let initialsLabel = UILabel()
    private let label = UILabel()
    private let speakingIndicator = UIView()
    private var participantId: String?
    private var didInstallFixedSizeConstraints = false
    var onTap: ((String) -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        configureViews()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configureViews()
    }

    func configure(participant: NativeVideoParticipant, isPrimary: Bool) {
        participantId = participant.id
        videoView.track = participant.track
        placeholderView.isHidden = participant.track != nil
        initialsLabel.text = initials(from: participant.title)
        label.text = participant.isScreenShare ? "Screen" : participant.title
        speakingIndicator.isHidden = !participant.isSpeaking
        layer.borderColor = (isPrimary ? UIColor.white : UIColor.white.withAlphaComponent(0.18)).cgColor
        layer.borderWidth = isPrimary ? 2 : 1
    }

    func prepareForRemoval() {
        videoView.track = nil
        placeholderView.isHidden = false
        onTap = nil
        participantId = nil
    }

    func ensureFixedSize() {
        guard !didInstallFixedSizeConstraints else { return }
        didInstallFixedSizeConstraints = true
        widthAnchor.constraint(equalToConstant: 128).isActive = true
        heightAnchor.constraint(equalToConstant: 92).isActive = true
    }

    private func configureViews() {
        backgroundColor = .black
        layer.cornerRadius = 10
        clipsToBounds = true

        videoView.layoutMode = .fill
        videoView.backgroundColor = .black
        addSubview(videoView)

        placeholderView.backgroundColor = UIColor(white: 0.08, alpha: 1)
        addSubview(placeholderView)

        initialsLabel.textColor = .white
        initialsLabel.textAlignment = .center
        initialsLabel.font = .systemFont(ofSize: 18, weight: .semibold)
        initialsLabel.backgroundColor = UIColor.white.withAlphaComponent(0.16)
        initialsLabel.layer.cornerRadius = 22
        initialsLabel.clipsToBounds = true
        placeholderView.addSubview(initialsLabel)

        label.textColor = .white
        label.font = .systemFont(ofSize: 12, weight: .semibold)
        label.lineBreakMode = .byTruncatingTail
        label.backgroundColor = UIColor.black.withAlphaComponent(0.48)
        label.textAlignment = .center
        addSubview(label)

        speakingIndicator.backgroundColor = UIColor.systemGreen
        speakingIndicator.layer.cornerRadius = 4
        addSubview(speakingIndicator)

        addTarget(self, action: #selector(tapped), for: .touchUpInside)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        videoView.frame = bounds
        placeholderView.frame = bounds
        initialsLabel.frame = CGRect(
            x: (bounds.width - 44) / 2,
            y: (bounds.height - 44) / 2,
            width: 44,
            height: 44
        )
        label.frame = CGRect(x: 0, y: bounds.height - 24, width: bounds.width, height: 24)
        speakingIndicator.frame = CGRect(x: bounds.width - 14, y: 8, width: 8, height: 8)
    }

    private func initials(from title: String) -> String {
        let words = title
            .split { $0.isWhitespace || $0 == "@" || $0 == "." || $0 == "|" }
            .map(String.init)
            .filter { !$0.isEmpty && $0.lowercased() != "macro" }
        if words.count >= 2 {
            return "\(words[0].prefix(1))\(words[1].prefix(1))".uppercased()
        }
        if let first = words.first {
            return String(first.prefix(1)).uppercased()
        }
        return "?"
    }

    @objc private func tapped() {
        guard let participantId else { return }
        onTap?(participantId)
    }
}

private final class PassthroughOverlayView: UIView {
    var onLayout: (() -> Void)?
    var blocksBackgroundTouches = false

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?()
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        if hit === self {
            return blocksBackgroundTouches ? self : nil
        }
        return hit
    }
}
