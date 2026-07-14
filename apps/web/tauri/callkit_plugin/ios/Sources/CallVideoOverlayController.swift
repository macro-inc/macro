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
    var avatarTitle: String? = nil
    let track: VideoTrack?
    let isSpeaking: Bool
    let isPinned: Bool
    let isScreenShare: Bool
}

struct CallVideoOverlayTheme {
    let drawerBackgroundColor: UIColor
    let textColor: UIColor
    let messageBackgroundColor: UIColor
    let overlayBackgroundColor: UIColor
    let edgeMutedColor: UIColor
    let edgeColor: UIColor
    let inkMutedColor: UIColor
    let failureColor: UIColor
    let failureInkColor: UIColor
    let successColor: UIColor

    static let fallback = CallVideoOverlayTheme(
        drawerBackgroundColor: UIColor.black.withAlphaComponent(0.94),
        textColor: .white,
        messageBackgroundColor: UIColor(white: 0.08, alpha: 1),
        overlayBackgroundColor: UIColor.black.withAlphaComponent(0.46),
        edgeMutedColor: UIColor(white: 0.18, alpha: 1),
        edgeColor: UIColor(white: 0.36, alpha: 1),
        inkMutedColor: UIColor(white: 0.84, alpha: 1),
        failureColor: UIColor.systemRed,
        failureInkColor: .white,
        successColor: UIColor.systemGreen
    )
}

/// Native video surface that floats above the Tauri WKWebView.
final class CallVideoOverlayController: NSObject, UIGestureRecognizerDelegate, UIScrollViewDelegate, @unchecked Sendable {
    private let rootView = PassthroughOverlayView()
    private let modalOverlayView = UIView()
    private let drawerView = UIView()
    private let drawerHandle = UIView()
    private let channelTitleLabel = UILabel()
    private let leaveButton = UIButton(type: .system)
    private let primaryVideoView = VideoView()
    private let primaryPlaceholderView = UIView()
    private let primaryInitialsLabel = UILabel()
    private let primaryEmptyStateLabel = UILabel()
    private let primaryParticipantLabel = UILabel()
    private let stripScrollView = UIScrollView()
    private let stripStackView = UIStackView()
    private let localTileView = RemoteVideoTileView(isMirrored: true)
    private let controlsView = UIStackView()
    private let microphoneButton = UIButton(type: .system)
    private let speakerButton = UIButton(type: .system)
    private let cameraButton = UIButton(type: .system)
    private let switchCameraButton = UIButton(type: .system)
    private let unpinButton = UIButton(type: .system)
    private let thumbnailView = UIView()
    private let thumbnailLocalVideoView = VideoView()
    private let thumbnailLocalPlaceholderView = UIView()
    private let thumbnailLocalInitialsLabel = UILabel()
    private let thumbnailRemoteVideoView = VideoView()
    private let thumbnailRemotePlaceholderView = UIView()
    private let thumbnailRemoteInitialsLabel = UILabel()
    private let thumbnailDividerView = UIView()
    private let edgeTabView = UILabel()

    var onToggleMicrophone: (() -> Void)?
    var onToggleSpeaker: (() -> Void)?
    var onToggleCamera: (() -> Void)?
    var onSwitchCamera: (() -> Void)?
    var onEndCall: (() -> Void)?
    var onSelectRemoteParticipant: ((String) -> Void)?
    var onOpenDrawerFromThumbnail: (() -> Void)?
    var onModeChanged: ((CallVideoOverlayMode) -> Void)?

    private var mode: CallVideoOverlayMode = .hidden
    private var thumbnailCorner: ThumbnailCorner = .topRight
    private var didAutoPresent = false
    private var isAudioMuted = false
    private var audioRoute = CallAudioRouteSnapshot(
        input: .unknown,
        output: .unknown,
        isSpeakerForced: false,
        supportsSpeakerToggle: true
    )
    private var isLocalVideoEnabled = false
    private var channelTitle = "Call"
    private var theme = CallVideoOverlayTheme.fallback
    private var localParticipantTitle = "You"
    private var localVideoTrack: VideoTrack?
    private var renderedLocalPreviewTrack: VideoTrack?
    private var remoteVideoParticipants: [NativeVideoParticipant] = []
    private var primaryRemoteParticipantId: String?
    private var pinnedRemoteParticipantId: String?
    private var primaryRemoteParticipantTitle: String?
    private var primaryRemoteVideoTrack: VideoTrack?
    private var renderedThumbnailLocalVideoTrack: VideoTrack?
    private var renderedThumbnailRemoteVideoTrack: VideoTrack?
    private var stripTileViews: [String: RemoteVideoTileView] = [:]
    private var isStripResyncScheduled = false
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
            self.bringOverlayToFrontIfNeeded()
            self.updateVideoRenderTargets()
            self.layoutOverlay()
            print("[CallKit] Native video overlay mode=\(mode.rawValue)")
            self.onModeChanged?(mode)
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

    func setTheme(_ theme: CallVideoOverlayTheme?) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.theme = theme ?? .fallback
            self.applyTheme()
            print("[CallKit] Native video overlay theme updated")
        }
    }

    func pictureInPictureSourceView() -> UIView {
        if mode == .minimized {
            return thumbnailView
        }

        return primaryVideoView
    }

    func presentForActiveCallIfNeeded() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.attachToBestAvailableParent()
            guard self.mode == .hidden, !self.didAutoPresent else { return }
            self.didAutoPresent = true
            self.mode = .expanded
            self.bringOverlayToFrontIfNeeded()
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
            self.pinnedRemoteParticipantId = nil
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
            self.bringOverlayToFrontIfNeeded()
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
            self.pinnedRemoteParticipantId = participants.first(where: { $0.isPinned })?.id

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

            self.bringOverlayToFrontIfNeeded()
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
            self.bringOverlayToFrontIfNeeded()
            self.layoutOverlay()
            print("[CallKit] Native video overlay localTrack=\(track == nil ? "nil" : "set")")
        }
    }

    func setLocalParticipantTitle(_ title: String?) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let trimmedTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let trimmedTitle, !trimmedTitle.isEmpty {
                self.localParticipantTitle = trimmedTitle
            } else {
                self.localParticipantTitle = "You"
            }
            self.configureLocalTile(track: self.renderedLocalPreviewTrack)
            self.layoutOverlay()
            print("[CallKit] Native video overlay localParticipantTitle=\(self.localParticipantTitle)")
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

    func setAudioRoute(_ route: CallAudioRouteSnapshot) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.audioRoute = route
            self.configureControlState()
            print("[CallKit] Native video overlay audioRoute input=\(route.input.rawValue) output=\(route.output.rawValue) speakerForced=\(route.isSpeakerForced) supportsSpeakerToggle=\(route.supportsSpeakerToggle)")
        }
    }

    func reset() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.primaryVideoView.track = nil
            self.thumbnailLocalVideoView.track = nil
            self.thumbnailLocalPlaceholderView.isHidden = false
            self.thumbnailRemoteVideoView.track = nil
            self.thumbnailRemotePlaceholderView.isHidden = false
            self.localVideoTrack = nil
            self.renderedLocalPreviewTrack = nil
            self.configureLocalTile(track: nil)
            self.remoteVideoParticipants = []
            self.primaryRemoteParticipantId = nil
            self.pinnedRemoteParticipantId = nil
            self.primaryRemoteParticipantTitle = nil
            self.primaryRemoteVideoTrack = nil
            self.renderedThumbnailLocalVideoTrack = nil
            self.renderedThumbnailRemoteVideoTrack = nil
            self.rebuildParticipantStrip()
            self.isAudioMuted = false
            self.audioRoute = CallAudioRouteSnapshot(
                input: .unknown,
                output: .unknown,
                isSpeakerForced: false,
                supportsSpeakerToggle: true
            )
            self.isLocalVideoEnabled = false
            self.localParticipantTitle = "You"
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

    /// The drawer is modal, so a webview input focused behind it would leave the
    /// virtual keyboard up with no way to dismiss it. Blur the DOM input and
    /// resign the webview's first responder whenever the drawer appears.
    private func dismissWebviewKeyboard() {
        guard let webview else { return }
        webview.endEditing(true)
        webview.evaluateJavaScript(
            "document.activeElement && document.activeElement.blur && document.activeElement.blur()",
            completionHandler: nil
        )
        print("[CallKit] Native video overlay dismissed webview keyboard for drawer")
    }

    /// Reordering the window's subviews while a touch is in flight destabilizes
    /// UIKit's gesture bookkeeping, so only reorder when actually occluded.
    private func bringOverlayToFrontIfNeeded() {
        guard let superview = rootView.superview, superview.subviews.last !== rootView else { return }
        superview.bringSubviewToFront(rootView)
    }

    private func configureViews() {
        rootView.backgroundColor = .clear
        rootView.onLayout = { [weak self] in self?.layoutOverlay() }

        modalOverlayView.backgroundColor = theme.overlayBackgroundColor
        rootView.addSubview(modalOverlayView)

        drawerView.backgroundColor = theme.drawerBackgroundColor
        drawerView.layer.cornerRadius = 18
        drawerView.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        drawerView.clipsToBounds = true
        rootView.addSubview(drawerView)

        let drawerPan = UIPanGestureRecognizer(target: self, action: #selector(dragDrawer(_:)))
        drawerPan.delegate = self
        drawerPan.cancelsTouchesInView = false
        drawerView.addGestureRecognizer(drawerPan)

        drawerHandle.backgroundColor = theme.edgeColor
        drawerHandle.layer.cornerRadius = 2
        drawerView.addSubview(drawerHandle)

        channelTitleLabel.text = channelTitle
        channelTitleLabel.textColor = theme.textColor
        channelTitleLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        channelTitleLabel.lineBreakMode = .byTruncatingTail
        drawerView.addSubview(channelTitleLabel)

        leaveButton.tintColor = theme.drawerBackgroundColor
        leaveButton.backgroundColor = theme.failureColor
        leaveButton.layer.cornerRadius = 16
        leaveButton.clipsToBounds = true
        leaveButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        leaveButton.setTitle("Leave", for: .normal)
        leaveButton.addTarget(self, action: #selector(endCall), for: .touchUpInside)
        drawerView.addSubview(leaveButton)

        primaryVideoView.layoutMode = .fill
        primaryVideoView.backgroundColor = theme.messageBackgroundColor
        primaryVideoView.layer.cornerRadius = 6
        primaryVideoView.clipsToBounds = true
        // VideoViews swap internal renderer subviews when tracks change; keeping
        // them out of hit-testing prevents an in-flight touch from losing its view.
        primaryVideoView.isUserInteractionEnabled = false
        drawerView.addSubview(primaryVideoView)

        primaryPlaceholderView.backgroundColor = theme.messageBackgroundColor
        primaryPlaceholderView.layer.cornerRadius = 6
        primaryPlaceholderView.clipsToBounds = true
        primaryPlaceholderView.isUserInteractionEnabled = false
        drawerView.addSubview(primaryPlaceholderView)

        primaryInitialsLabel.textColor = theme.textColor
        primaryInitialsLabel.textAlignment = .center
        primaryInitialsLabel.font = .systemFont(ofSize: 34, weight: .semibold)
        primaryInitialsLabel.backgroundColor = theme.edgeMutedColor
        primaryInitialsLabel.layer.cornerRadius = 38
        primaryInitialsLabel.clipsToBounds = true
        primaryPlaceholderView.addSubview(primaryInitialsLabel)

        primaryEmptyStateLabel.text = "No one else is here"
        primaryEmptyStateLabel.textColor = theme.inkMutedColor
        primaryEmptyStateLabel.textAlignment = .center
        primaryEmptyStateLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        primaryEmptyStateLabel.numberOfLines = 0
        primaryPlaceholderView.addSubview(primaryEmptyStateLabel)

        primaryParticipantLabel.textColor = theme.textColor
        primaryParticipantLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        primaryParticipantLabel.lineBreakMode = .byTruncatingTail
        primaryParticipantLabel.backgroundColor = theme.edgeMutedColor
        primaryParticipantLabel.textAlignment = .center
        primaryParticipantLabel.layer.cornerRadius = 8
        primaryParticipantLabel.clipsToBounds = true
        drawerView.addSubview(primaryParticipantLabel)

        stripScrollView.showsHorizontalScrollIndicator = false
        stripScrollView.alwaysBounceHorizontal = true
        stripScrollView.backgroundColor = .clear
        stripScrollView.delaysContentTouches = false
        stripScrollView.delegate = self
        drawerView.addSubview(stripScrollView)

        stripStackView.axis = .horizontal
        stripStackView.alignment = .fill
        stripStackView.distribution = .fill
        stripStackView.spacing = 10
        stripScrollView.addSubview(stripStackView)

        localTileView.applyTheme(theme)
        localTileView.configure(
            participant: NativeVideoParticipant(
                id: "__local",
                title: "You",
                avatarTitle: self.localParticipantTitle,
                track: nil,
                isSpeaking: false,
                isPinned: true,
                isScreenShare: false
            ),
            isPrimary: false
        )
        drawerView.addSubview(localTileView)

        controlsView.axis = .horizontal
        controlsView.alignment = .fill
        controlsView.distribution = .fill
        controlsView.spacing = 10
        controlsView.backgroundColor = .clear
        controlsView.clipsToBounds = false
        drawerView.addSubview(controlsView)

        configureControlButton(microphoneButton, systemImageName: "mic.fill", action: #selector(toggleMicrophone))
        configureControlButton(speakerButton, systemImageName: "speaker.wave.2.fill", action: #selector(toggleSpeaker))
        configureControlButton(cameraButton, systemImageName: "video.slash.fill", action: #selector(toggleCamera))
        speakerButton.layer.maskedCorners = [.layerMinXMinYCorner, .layerMinXMaxYCorner]
        microphoneButton.layer.maskedCorners = []
        cameraButton.layer.maskedCorners = [.layerMaxXMinYCorner, .layerMaxXMaxYCorner]
        controlsView.addArrangedSubview(speakerButton)
        controlsView.addArrangedSubview(microphoneButton)
        controlsView.addArrangedSubview(cameraButton)

        configurePreviewOverlayButton(switchCameraButton, systemImageName: "camera.rotate.fill", action: #selector(switchCamera))
        drawerView.addSubview(switchCameraButton)

        configurePreviewOverlayButton(unpinButton, systemImageName: "pin.fill", action: #selector(unpinRemoteParticipant))
        unpinButton.accessibilityLabel = "Unpin participant"
        drawerView.addSubview(unpinButton)
        configureControlState()

        let minimizeTap = UITapGestureRecognizer(target: self, action: #selector(minimizeFromDrawer))
        drawerHandle.addGestureRecognizer(minimizeTap)
        drawerHandle.isUserInteractionEnabled = true

        thumbnailView.backgroundColor = theme.messageBackgroundColor
        thumbnailView.layer.cornerRadius = 12
        thumbnailView.layer.borderColor = theme.edgeColor.cgColor
        thumbnailView.layer.borderWidth = 1
        thumbnailView.clipsToBounds = true
        rootView.addSubview(thumbnailView)

        thumbnailLocalVideoView.layoutMode = .fill
        thumbnailLocalVideoView.mirrorMode = .auto
        thumbnailLocalVideoView.backgroundColor = theme.messageBackgroundColor
        thumbnailLocalVideoView.isUserInteractionEnabled = false
        thumbnailView.addSubview(thumbnailLocalVideoView)

        configureThumbnailPlaceholder(thumbnailLocalPlaceholderView, initialsLabel: thumbnailLocalInitialsLabel)
        thumbnailView.addSubview(thumbnailLocalPlaceholderView)

        thumbnailRemoteVideoView.layoutMode = .fill
        thumbnailRemoteVideoView.backgroundColor = theme.messageBackgroundColor
        thumbnailRemoteVideoView.isUserInteractionEnabled = false
        thumbnailView.addSubview(thumbnailRemoteVideoView)

        configureThumbnailPlaceholder(thumbnailRemotePlaceholderView, initialsLabel: thumbnailRemoteInitialsLabel)
        thumbnailView.addSubview(thumbnailRemotePlaceholderView)

        thumbnailDividerView.backgroundColor = theme.edgeColor
        thumbnailView.addSubview(thumbnailDividerView)

        let thumbnailTap = UITapGestureRecognizer(target: self, action: #selector(expandFromThumbnail))
        thumbnailView.addGestureRecognizer(thumbnailTap)
        let thumbnailPan = UIPanGestureRecognizer(target: self, action: #selector(dragThumbnail(_:)))
        thumbnailView.addGestureRecognizer(thumbnailPan)

        edgeTabView.backgroundColor = theme.edgeMutedColor
        edgeTabView.textColor = theme.textColor
        edgeTabView.textAlignment = .center
        edgeTabView.font = .boldSystemFont(ofSize: 18)
        edgeTabView.layer.cornerRadius = 10
        edgeTabView.clipsToBounds = true
        edgeTabView.isUserInteractionEnabled = true
        edgeTabView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(showThumbnailFromEdge)))
        rootView.addSubview(edgeTabView)
    }

    private func configureControlButton(_ button: UIButton, systemImageName: String, action: Selector) {
        button.layer.cornerRadius = 8
        applyActionButtonTheme(button)
        button.clipsToBounds = true
        button.setImage(UIImage(systemName: systemImageName), for: .normal)
        button.addTarget(self, action: action, for: .touchUpInside)
        button.widthAnchor.constraint(equalToConstant: 48).isActive = true
        button.heightAnchor.constraint(equalToConstant: 44).isActive = true
    }

    private func applyActionButtonTheme(_ button: UIButton, isActive: Bool = false) {
        button.tintColor = theme.textColor
        button.backgroundColor = isActive
            ? theme.edgeMutedColor
            : theme.inkMutedColor.withAlphaComponent(0.025)
        button.layer.borderColor = isActive
            ? theme.edgeColor.cgColor
            : theme.inkMutedColor.withAlphaComponent(0.08).cgColor
        button.layer.borderWidth = 1
    }

    private func configurePreviewOverlayButton(_ button: UIButton, systemImageName: String, action: Selector) {
        button.tintColor = theme.textColor
        button.backgroundColor = theme.edgeMutedColor
        button.layer.cornerRadius = 18
        button.layer.borderColor = theme.edgeColor.cgColor
        button.layer.borderWidth = 1
        button.clipsToBounds = true
        button.setImage(UIImage(systemName: systemImageName), for: .normal)
        button.addTarget(self, action: action, for: .touchUpInside)
    }

    private func configureThumbnailPlaceholder(_ placeholderView: UIView, initialsLabel: UILabel) {
        placeholderView.backgroundColor = theme.messageBackgroundColor
        placeholderView.isUserInteractionEnabled = false

        initialsLabel.textColor = theme.textColor
        initialsLabel.textAlignment = .center
        initialsLabel.font = .systemFont(ofSize: 18, weight: .semibold)
        initialsLabel.numberOfLines = 2
        initialsLabel.backgroundColor = theme.edgeMutedColor
        initialsLabel.layer.cornerRadius = 22
        initialsLabel.clipsToBounds = true
        placeholderView.addSubview(initialsLabel)
    }

    private func participantLabelBackgroundColor(hasVideo: Bool) -> UIColor {
        hasVideo ? theme.drawerBackgroundColor.withAlphaComponent(0.70) : theme.edgeMutedColor
    }

    private func configureControlState() {
        let microphoneImage = isAudioMuted ? "mic.slash.fill" : "mic.fill"
        microphoneButton.setImage(UIImage(systemName: microphoneImage), for: .normal)
        applyActionButtonTheme(microphoneButton)

        speakerButton.setImage(audioRouteButtonImage(), for: .normal)
        speakerButton.isEnabled = audioRoute.supportsSpeakerToggle
        speakerButton.alpha = audioRoute.supportsSpeakerToggle ? 1 : 0.45
        applyActionButtonTheme(speakerButton, isActive: audioRoute.output == .speaker || (audioRoute.output == .unknown && audioRoute.isSpeakerForced))

        let cameraImage = isLocalVideoEnabled ? "video.fill" : "video.slash.fill"
        cameraButton.setImage(UIImage(systemName: cameraImage), for: .normal)
        applyActionButtonTheme(cameraButton)
        switchCameraButton.isHidden = !isLocalVideoEnabled
    }

    private func audioRouteButtonImage() -> UIImage? {
        switch audioRoute.output {
        case .speaker, .receiver, .unknown:
            return UIImage(systemName: "speaker.wave.2.fill")
        case .bluetooth:
            return UIImage(systemName: "bluetooth") ?? bluetoothTemplateImage()
        case .headphones:
            return UIImage(systemName: "headphones")
        case .external:
            return UIImage(systemName: "airplayaudio") ?? UIImage(systemName: "speaker.wave.2.fill")
        }
    }

    private func bluetoothTemplateImage() -> UIImage {
        let size = CGSize(width: 20, height: 20)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { context in
            let h = size.height
            let y1 = h * 0.05
            let y2 = h * 0.25
            let cgContext = context.cgContext
            cgContext.move(to: CGPoint(x: y2, y: y2))
            cgContext.addLine(to: CGPoint(x: h - y2, y: h - y2))
            cgContext.addLine(to: CGPoint(x: h / 2, y: h - y1))
            cgContext.addLine(to: CGPoint(x: h / 2, y: y1))
            cgContext.addLine(to: CGPoint(x: h - y2, y: y2))
            cgContext.addLine(to: CGPoint(x: y2, y: h - y2))
            cgContext.setStrokeColor(UIColor.black.cgColor)
            cgContext.setLineCap(.round)
            cgContext.setLineJoin(.round)
            cgContext.setLineWidth(2)
            cgContext.strokePath()
        }.withRenderingMode(.alwaysTemplate)
    }

    /// True while UIKit is delivering a touch through the strip (control tracking
    /// or scroll tracking). Structural strip changes are unsafe during this window.
    /// The pan state check also covers the teardown moment right after a flick,
    /// when the finger is up but delayed-touch records are still being resolved.
    private var isParticipantStripInteracting: Bool {
        stripScrollView.isTracking
            || stripScrollView.isDragging
            || stripScrollView.panGestureRecognizer.state != .possible
            || stripTileViews.values.contains(where: \.isTracking)
    }

    private func rebuildParticipantStrip() {
        UIView.performWithoutAnimation {
            let participants = stripParticipants

            // Inserting, removing, or reordering tiles while UIKit is delivering a
            // touch through the strip corrupts the delayed-touch gesture machinery
            // (-[UIGestureRecognizer _delayTouchesForEvent:] throws NSInvalidArgument
            // and the app dies). While a touch is active, only restyle the tiles that
            // already exist; onTrackingEnded / scrollViewDidEnd* re-run this rebuild
            // to apply the structural sync afterwards.
            guard !isParticipantStripInteracting else {
                for participant in participants {
                    guard let tile = stripTileViews[participant.id] else { continue }
                    configureStripTile(tile, participant: participant)
                }
                scheduleParticipantStripResync()
                return
            }

            let activeIds = Set(participants.map(\.id))
            let staleIds = stripTileViews.keys.filter { !activeIds.contains($0) }
            for id in staleIds {
                guard let tile = stripTileViews.removeValue(forKey: id) else { continue }
                tile.prepareForRemoval()
                stripStackView.removeArrangedSubview(tile)
                tile.removeFromSuperview()
            }

            for (index, participant) in participants.enumerated() {
                let tile = stripTileViews[participant.id] ?? RemoteVideoTileView()
                stripTileViews[participant.id] = tile
                configureStripTile(tile, participant: participant)
                tile.ensureFixedSize()
                let arrangedTiles = stripStackView.arrangedSubviews
                if index >= arrangedTiles.count || arrangedTiles[index] !== tile {
                    stripStackView.insertArrangedSubview(tile, at: min(index, arrangedTiles.count))
                }
            }
        }
    }

    private func configureStripTile(_ tile: RemoteVideoTileView, participant: NativeVideoParticipant) {
        tile.applyTheme(theme)
        tile.configure(participant: participant, isPrimary: participant.id == primaryRemoteParticipantId)
        tile.onTap = { [weak self] id in
            print("[CallKit] Native video overlay remote tile tapped id=\(id)")
            self?.onSelectRemoteParticipant?(id)
        }
        tile.onTrackingEnded = { [weak self] in
            self?.resyncParticipantStripAfterInteraction()
        }
    }

    private func resyncParticipantStripAfterInteraction() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.rebuildParticipantStrip()
            self.layoutOverlay()
        }
    }

    /// Coalesced retry so deferred structural changes converge even when no
    /// end-of-interaction callback fires (e.g. a touch-down that never drags).
    private func scheduleParticipantStripResync() {
        guard !isStripResyncScheduled else { return }
        isStripResyncScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard let self else { return }
            self.isStripResyncScheduled = false
            self.rebuildParticipantStrip()
            self.layoutOverlay()
        }
    }

    private var stripParticipants: [NativeVideoParticipant] {
        remoteVideoParticipants.filter { $0.id != primaryRemoteParticipantId }
    }

    private func applyTheme() {
        applyDrawerTheme()
        applyPrimaryVideoTheme()
        applyParticipantStripTheme()
        applyControlsTheme()
        applyThumbnailTheme()
        applyEdgeTabTheme()
        layoutOverlay()
    }

    private func applyDrawerTheme() {
        drawerView.backgroundColor = theme.drawerBackgroundColor
        modalOverlayView.backgroundColor = theme.overlayBackgroundColor
        drawerHandle.backgroundColor = theme.edgeColor
        channelTitleLabel.textColor = theme.textColor
        leaveButton.tintColor = theme.drawerBackgroundColor
        leaveButton.backgroundColor = theme.failureColor
    }

    private func applyPrimaryVideoTheme() {
        primaryVideoView.backgroundColor = theme.messageBackgroundColor
        primaryPlaceholderView.backgroundColor = theme.messageBackgroundColor
        primaryInitialsLabel.textColor = theme.textColor
        primaryInitialsLabel.backgroundColor = theme.edgeMutedColor
        primaryEmptyStateLabel.textColor = theme.inkMutedColor
        primaryParticipantLabel.textColor = theme.textColor
        primaryParticipantLabel.backgroundColor = participantLabelBackgroundColor(hasVideo: primaryRemoteVideoTrack != nil)
    }

    private func applyParticipantStripTheme() {
        localTileView.applyTheme(theme)
        for tile in stripTileViews.values {
            tile.applyTheme(theme)
        }
    }

    private func applyControlsTheme() {
        controlsView.backgroundColor = .clear
        applyActionButtonTheme(microphoneButton)
        applyActionButtonTheme(cameraButton)
        switchCameraButton.tintColor = theme.textColor
        switchCameraButton.backgroundColor = theme.edgeMutedColor
        switchCameraButton.layer.borderColor = theme.edgeColor.cgColor
        unpinButton.tintColor = theme.textColor
        unpinButton.backgroundColor = theme.edgeMutedColor
        unpinButton.layer.borderColor = theme.edgeColor.cgColor
        configureControlState()
    }

    private func applyThumbnailTheme() {
        thumbnailView.backgroundColor = theme.messageBackgroundColor
        thumbnailView.layer.borderColor = theme.edgeColor.cgColor
        thumbnailLocalVideoView.backgroundColor = theme.messageBackgroundColor
        thumbnailRemoteVideoView.backgroundColor = theme.messageBackgroundColor
        thumbnailLocalPlaceholderView.backgroundColor = theme.messageBackgroundColor
        thumbnailRemotePlaceholderView.backgroundColor = theme.messageBackgroundColor
        thumbnailLocalInitialsLabel.textColor = theme.textColor
        thumbnailLocalInitialsLabel.backgroundColor = theme.edgeMutedColor
        thumbnailRemoteInitialsLabel.textColor = theme.textColor
        if primaryRemoteParticipantTitle != nil {
            thumbnailRemoteInitialsLabel.backgroundColor = theme.edgeMutedColor
        }
        thumbnailDividerView.backgroundColor = theme.edgeColor
    }

    private func applyEdgeTabTheme() {
        edgeTabView.backgroundColor = theme.edgeMutedColor
        edgeTabView.textColor = theme.textColor
    }

    private func updateVideoRenderTargets() {
        updateLocalPreviewTrack()
        updateThumbnailTracks()
    }

    private func updateLocalPreviewTrack() {
        let desiredTrack = mode == .expanded ? localVideoTrack : nil
        guard renderedLocalPreviewTrack !== desiredTrack else { return }
        renderedLocalPreviewTrack = desiredTrack
        configureLocalTile(track: desiredTrack)
    }

    private func configureLocalTile(track: VideoTrack?) {
        localTileView.applyTheme(theme)
        localTileView.configure(
            participant: NativeVideoParticipant(
                id: "__local",
                title: "You",
                avatarTitle: localParticipantTitle,
                track: track,
                isSpeaking: false,
                isPinned: true,
                isScreenShare: false
            ),
            isPrimary: false
        )
    }

    private func updateThumbnailTracks() {
        let desiredLocalTrack = mode == .minimized ? localVideoTrack : nil
        if renderedThumbnailLocalVideoTrack !== desiredLocalTrack {
            renderedThumbnailLocalVideoTrack = desiredLocalTrack
            thumbnailLocalVideoView.track = desiredLocalTrack
        }
        thumbnailLocalPlaceholderView.isHidden = desiredLocalTrack != nil

        let desiredRemoteTrack = mode == .minimized ? primaryRemoteVideoTrack : nil
        if renderedThumbnailRemoteVideoTrack !== desiredRemoteTrack {
            renderedThumbnailRemoteVideoTrack = desiredRemoteTrack
            thumbnailRemoteVideoView.track = desiredRemoteTrack
        }
        thumbnailRemotePlaceholderView.isHidden = desiredRemoteTrack != nil
    }

    private func layoutOverlay() {
        let bounds = rootView.bounds
        guard !bounds.isEmpty else { return }

        let shouldShowDrawer = mode == .expanded
        if shouldShowDrawer, drawerView.isHidden {
            dismissWebviewKeyboard()
        }
        drawerView.isHidden = !shouldShowDrawer
        modalOverlayView.isHidden = !shouldShowDrawer
        thumbnailView.isHidden = mode != .minimized
        edgeTabView.isHidden = mode != .hidden || primaryRemoteParticipantTitle == nil
        rootView.blocksBackgroundTouches = mode == .expanded

        modalOverlayView.frame = bounds
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
        let shouldShowParticipantRow = mode == .expanded
        let stripHeight: CGFloat = shouldShowParticipantRow ? 92 : 0
        let controlsSize = controlsView.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
        let controlsBottomInset: CGFloat = 36
        let controlsTop = drawerView.bounds.height - controlsSize.height - controlsBottomInset
        let participantControlsGap: CGFloat = stripHeight > 0 ? 14 : 28
        let stripTop = controlsTop - stripHeight - participantControlsGap
        let primaryStripGap: CGFloat = stripHeight > 0 ? 18 : 0
        let primaryHorizontalInset: CGFloat = 16
        primaryVideoView.frame = CGRect(
            x: primaryHorizontalInset,
            y: 62,
            width: max(0, drawerView.bounds.width - (primaryHorizontalInset * 2)),
            height: max(0, stripTop - 62 - primaryStripGap)
        )
        let primaryHasParticipant = primaryRemoteParticipantTitle != nil
        let primaryHasVideo = primaryRemoteVideoTrack != nil
        primaryPlaceholderView.frame = primaryVideoView.frame
        primaryPlaceholderView.isHidden = primaryHasParticipant && primaryHasVideo
        primaryInitialsLabel.isHidden = !primaryHasParticipant
        primaryEmptyStateLabel.isHidden = primaryHasParticipant
        primaryInitialsLabel.text = primaryRemoteParticipantTitle.map(initials)
        primaryInitialsLabel.frame = CGRect(
            x: (primaryPlaceholderView.bounds.width - 76) / 2,
            y: (primaryPlaceholderView.bounds.height - 76) / 2,
            width: 76,
            height: 76
        )
        primaryEmptyStateLabel.frame = primaryPlaceholderView.bounds.insetBy(dx: 24, dy: 0)
        primaryParticipantLabel.text = primaryRemoteParticipantTitle
        primaryParticipantLabel.isHidden = primaryRemoteParticipantTitle == nil
        primaryParticipantLabel.backgroundColor = participantLabelBackgroundColor(hasVideo: primaryHasVideo)
        let primaryParticipantLabelSize = primaryParticipantLabel.sizeThatFits(
            CGSize(width: max(0, drawerView.bounds.width - 28), height: 28)
        )
        let primaryParticipantLabelWidth = min(
            max(0, drawerView.bounds.width - 28),
            primaryParticipantLabelSize.width + 12
        )
        primaryParticipantLabel.frame = CGRect(
            x: primaryVideoView.frame.minX + 10,
            y: primaryVideoView.frame.maxY - 42,
            width: primaryParticipantLabelWidth,
            height: 28
        )

        unpinButton.frame = CGRect(
            x: primaryVideoView.frame.maxX - 44,
            y: primaryVideoView.frame.minY + 8,
            width: 36,
            height: 36
        )
        unpinButton.isHidden = pinnedRemoteParticipantId == nil

        let tileWidth: CGFloat = 128
        let tileSpacing: CGFloat = 10
        let rowHorizontalInset: CGFloat = 16
        localTileView.isHidden = stripHeight == 0
        localTileView.frame = CGRect(
            x: rowHorizontalInset,
            y: stripTop,
            width: tileWidth,
            height: stripHeight
        )

        let scrollX = localTileView.frame.maxX + tileSpacing
        stripScrollView.isHidden = stripHeight == 0 || stripParticipantCount == 0
        stripScrollView.frame = CGRect(
            x: scrollX,
            y: stripTop,
            width: max(0, drawerView.bounds.width - scrollX - rowHorizontalInset),
            height: stripHeight
        )
        stripStackView.frame = CGRect(
            x: 0,
            y: 0,
            width: CGFloat(stripParticipantCount) * tileWidth + CGFloat(max(stripParticipantCount - 1, 0)) * tileSpacing,
            height: stripHeight
        )
        stripScrollView.contentSize = CGSize(width: stripStackView.frame.width, height: stripHeight)
        stripStackView.arrangedSubviews.forEach { $0.frame.size = CGSize(width: tileWidth, height: stripHeight) }

        switchCameraButton.frame = CGRect(
            x: localTileView.frame.maxX - 44,
            y: localTileView.frame.maxY - 44,
            width: 36,
            height: 36
        )
        switchCameraButton.isHidden = !isLocalVideoEnabled || localTileView.isHidden
        drawerView.bringSubviewToFront(switchCameraButton)
        controlsView.frame = CGRect(
            x: (drawerView.bounds.width - controlsSize.width) / 2,
            y: controlsTop,
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
        thumbnailLocalPlaceholderView.frame = thumbnailLocalVideoView.frame
        thumbnailLocalInitialsLabel.text = initials(from: localParticipantTitle)
        thumbnailLocalInitialsLabel.frame = CGRect(
            x: (thumbnailLocalPlaceholderView.bounds.width - 44) / 2,
            y: (thumbnailLocalPlaceholderView.bounds.height - 44) / 2,
            width: 44,
            height: 44
        )
        thumbnailRemoteVideoView.frame = CGRect(
            x: thumbnailHalfWidth,
            y: 0,
            width: thumbnailView.bounds.width - thumbnailHalfWidth,
            height: thumbnailView.bounds.height
        )
        thumbnailRemotePlaceholderView.frame = thumbnailRemoteVideoView.frame
        if let primaryRemoteParticipantTitle {
            thumbnailRemoteInitialsLabel.text = initials(from: primaryRemoteParticipantTitle)
            thumbnailRemoteInitialsLabel.font = .systemFont(ofSize: 18, weight: .semibold)
            thumbnailRemoteInitialsLabel.backgroundColor = theme.edgeMutedColor
            thumbnailRemoteInitialsLabel.layer.cornerRadius = 22
            thumbnailRemoteInitialsLabel.frame = CGRect(
                x: (thumbnailRemotePlaceholderView.bounds.width - 44) / 2,
                y: (thumbnailRemotePlaceholderView.bounds.height - 44) / 2,
                width: 44,
                height: 44
            )
        } else {
            thumbnailRemoteInitialsLabel.text = "No one\nelse is here"
            thumbnailRemoteInitialsLabel.font = .systemFont(ofSize: 11, weight: .semibold)
            thumbnailRemoteInitialsLabel.backgroundColor = .clear
            thumbnailRemoteInitialsLabel.layer.cornerRadius = 0
            thumbnailRemoteInitialsLabel.frame = thumbnailRemotePlaceholderView.bounds.insetBy(dx: 8, dy: 0)
        }
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

    @objc private func toggleSpeaker() {
        print("[CallKit] Native video overlay speaker toggle tapped output=\(audioRoute.output.rawValue) speakerForced=\(audioRoute.isSpeakerForced) supportsSpeakerToggle=\(audioRoute.supportsSpeakerToggle)")
        guard audioRoute.supportsSpeakerToggle else { return }
        onToggleSpeaker?()
    }

    @objc private func toggleCamera() {
        print("[CallKit] Native video overlay camera toggle tapped currentEnabled=\(isLocalVideoEnabled)")
        onToggleCamera?()
    }

    @objc private func switchCamera() {
        print("[CallKit] Native video overlay camera switch tapped")
        onSwitchCamera?()
    }

    @objc private func unpinRemoteParticipant() {
        guard let pinnedRemoteParticipantId else { return }
        print("[CallKit] Native video overlay unpin tapped id=\(pinnedRemoteParticipantId)")
        onSelectRemoteParticipant?(pinnedRemoteParticipantId)
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

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        guard scrollView === stripScrollView, !decelerate else { return }
        resyncParticipantStripAfterInteraction()
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        guard scrollView === stripScrollView else { return }
        resyncParticipantStripAfterInteraction()
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
    private let isMirrored: Bool
    private var theme = CallVideoOverlayTheme.fallback
    private var participantId: String?
    private var hasVideoTrack = false
    private var didInstallFixedSizeConstraints = false
    var onTap: ((String) -> Void)?
    var onTrackingEnded: (() -> Void)?

    init(frame: CGRect = .zero, isMirrored: Bool = false) {
        self.isMirrored = isMirrored
        super.init(frame: frame)
        configureViews()
    }

    required init?(coder: NSCoder) {
        self.isMirrored = false
        super.init(coder: coder)
        configureViews()
    }

    func configure(participant: NativeVideoParticipant, isPrimary: Bool) {
        participantId = participant.id
        hasVideoTrack = participant.track != nil
        videoView.track = participant.track
        placeholderView.isHidden = hasVideoTrack
        initialsLabel.text = initials(from: participant.avatarTitle ?? participant.title)
        label.text = participant.isScreenShare ? "Screen" : participant.title
        applyLabelBackground()
        speakingIndicator.isHidden = !participant.isSpeaking
        layer.borderColor = (isPrimary ? theme.edgeColor : theme.edgeMutedColor).cgColor
        layer.borderWidth = isPrimary ? 2 : 1
        setNeedsLayout()
    }

    func prepareForRemoval() {
        onTrackingEnded = nil
        cancelTracking(with: nil)
        videoView.track = nil
        placeholderView.isHidden = false
        onTap = nil
        participantId = nil
        hasVideoTrack = false
        applyLabelBackground()
    }

    override func endTracking(_ touch: UITouch?, with event: UIEvent?) {
        super.endTracking(touch, with: event)
        onTrackingEnded?()
    }

    override func cancelTracking(with event: UIEvent?) {
        super.cancelTracking(with: event)
        onTrackingEnded?()
    }

    func applyTheme(_ theme: CallVideoOverlayTheme) {
        self.theme = theme
        backgroundColor = theme.messageBackgroundColor
        videoView.backgroundColor = theme.messageBackgroundColor
        placeholderView.backgroundColor = theme.messageBackgroundColor
        initialsLabel.textColor = theme.textColor
        initialsLabel.backgroundColor = theme.edgeMutedColor
        label.textColor = theme.textColor
        applyLabelBackground()
        speakingIndicator.backgroundColor = theme.successColor
    }

    func ensureFixedSize() {
        guard !didInstallFixedSizeConstraints else { return }
        didInstallFixedSizeConstraints = true
        widthAnchor.constraint(equalToConstant: 128).isActive = true
        heightAnchor.constraint(equalToConstant: 92).isActive = true
    }

    private func configureViews() {
        backgroundColor = theme.messageBackgroundColor
        layer.cornerRadius = 6
        clipsToBounds = true

        videoView.layoutMode = .fill
        videoView.mirrorMode = isMirrored ? .auto : .off
        videoView.backgroundColor = theme.messageBackgroundColor
        // Keep hit-testing on the control itself: VideoView swaps its internal
        // renderer subviews when tracks change, and detaching the view UIKit
        // associated with an in-flight touch corrupts touch delivery.
        videoView.isUserInteractionEnabled = false
        addSubview(videoView)

        placeholderView.backgroundColor = CallVideoOverlayTheme.fallback.messageBackgroundColor
        placeholderView.isUserInteractionEnabled = false
        addSubview(placeholderView)

        initialsLabel.textColor = CallVideoOverlayTheme.fallback.textColor
        initialsLabel.textAlignment = .center
        initialsLabel.font = .systemFont(ofSize: 18, weight: .semibold)
        initialsLabel.backgroundColor = CallVideoOverlayTheme.fallback.edgeMutedColor
        initialsLabel.layer.cornerRadius = 22
        initialsLabel.clipsToBounds = true
        placeholderView.addSubview(initialsLabel)

        label.textColor = CallVideoOverlayTheme.fallback.textColor
        label.font = .systemFont(ofSize: 12, weight: .semibold)
        label.lineBreakMode = .byTruncatingTail
        label.backgroundColor = CallVideoOverlayTheme.fallback.edgeMutedColor
        label.textAlignment = .center
        addSubview(label)

        speakingIndicator.backgroundColor = CallVideoOverlayTheme.fallback.successColor
        speakingIndicator.layer.cornerRadius = 4
        speakingIndicator.isUserInteractionEnabled = false
        addSubview(speakingIndicator)

        addTarget(self, action: #selector(tapped), for: .touchUpInside)
    }

    private func applyLabelBackground() {
        label.backgroundColor = hasVideoTrack
            ? theme.drawerBackgroundColor.withAlphaComponent(0.70)
            : theme.edgeMutedColor
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
        let labelHeight: CGFloat = 22
        let labelY = bounds.height - 26
        let labelSize = label.sizeThatFits(CGSize(width: bounds.width - 12, height: labelHeight))
        let labelWidth = min(max(0, bounds.width - 12), labelSize.width + 12)
        label.frame = CGRect(x: 6, y: labelY, width: labelWidth, height: labelHeight)
        label.layer.cornerRadius = 8
        label.clipsToBounds = true
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
