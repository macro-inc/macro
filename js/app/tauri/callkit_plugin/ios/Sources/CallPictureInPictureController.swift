import AVFoundation
import AVKit
import LiveKit
import UIKit

protocol CallPictureInPictureManaging: AnyObject {
    func prepare()
    func setParticipants(
        localTitle: String?,
        localTrack: VideoTrack?,
        remoteTitle: String?,
        remoteTrack: VideoTrack?
    )
    func stopAndReset()
}

func makeCallPictureInPictureController(
    sourceViewProvider: @escaping () -> UIView?,
    onRestore: @escaping () -> Void
) -> CallPictureInPictureManaging {
    if #available(iOS 15.0, *) {
        return AVKitCallPictureInPictureController(
            sourceViewProvider: sourceViewProvider,
            onRestore: onRestore
        )
    }

    return NoOpCallPictureInPictureController()
}

private final class NoOpCallPictureInPictureController: CallPictureInPictureManaging {
    func prepare() {}

    func setParticipants(
        localTitle: String?,
        localTrack: VideoTrack?,
        remoteTitle: String?,
        remoteTrack: VideoTrack?
    ) {
        if localTrack != nil || remoteTrack != nil {
            print("[CallKit] Picture in Picture unavailable before iOS 15")
        }
    }

    func stopAndReset() {}
}

@available(iOS 15.0, *)
private final class AVKitCallPictureInPictureController: NSObject, AVPictureInPictureControllerDelegate, CallPictureInPictureManaging, @unchecked Sendable {
    private let sourceViewProvider: () -> UIView?
    private let onRestore: () -> Void
    private let videoCallController = CallPiPVideoCallViewController()

    private weak var currentSourceView: UIView?
    private weak var currentLocalTrack: VideoTrack?
    private weak var currentRemoteTrack: VideoTrack?
    private var currentLocalTitle: String?
    private var currentRemoteTitle: String?
    private var pictureInPictureController: AVPictureInPictureController?
    private var didObserveAppLifecycle = false

    init(
        sourceViewProvider: @escaping () -> UIView?,
        onRestore: @escaping () -> Void
    ) {
        self.sourceViewProvider = sourceViewProvider
        self.onRestore = onRestore
        super.init()
        observeAppLifecycle()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    func prepare() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.prepareControllerIfPossible()
        }
    }

    func setParticipants(
        localTitle: String?,
        localTrack: VideoTrack?,
        remoteTitle: String?,
        remoteTrack: VideoTrack?
    ) {
        DispatchQueue.main.async { [weak self, weak localTrack, weak remoteTrack] in
            guard let self else { return }

            let normalizedLocalTitle = self.normalizedTitle(localTitle)
            let normalizedRemoteTitle = self.normalizedTitle(remoteTitle)
            self.currentLocalTitle = normalizedLocalTitle
            self.currentRemoteTitle = normalizedRemoteTitle
            self.videoCallController.setTitles(
                localTitle: normalizedLocalTitle,
                remoteTitle: normalizedRemoteTitle
            )
            print("[CallKit] Picture in Picture setParticipants localTitle=\(normalizedLocalTitle ?? "nil") localTrack=\(localTrack == nil ? "nil" : "set") remoteTitle=\(normalizedRemoteTitle ?? "nil") remoteTrack=\(remoteTrack == nil ? "nil" : "set")")

            if self.currentLocalTrack !== localTrack {
                self.currentLocalTrack = localTrack
                self.videoCallController.setLocalTrack(localTrack)
                print("[CallKit] Picture in Picture local video track \(localTrack == nil ? "detached" : "attached")")
            }

            if self.currentRemoteTrack !== remoteTrack {
                self.currentRemoteTrack = remoteTrack
                self.videoCallController.setRemoteTrack(remoteTrack)
                print("[CallKit] Picture in Picture remote video track \(remoteTrack == nil ? "detached" : "attached")")
            }

            if localTrack == nil {
                print("[CallKit] Picture in Picture local side using placeholder")
            }
            if remoteTrack == nil {
                print("[CallKit] Picture in Picture remote side using placeholder")
            }
            self.prepareControllerIfPossible()
        }
    }

    func stopAndReset() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if self.pictureInPictureController?.isPictureInPictureActive == true {
                print("[CallKit] Stopping Picture in Picture")
                self.pictureInPictureController?.stopPictureInPicture()
            }
            self.currentLocalTrack = nil
            self.currentRemoteTrack = nil
            self.currentLocalTitle = nil
            self.currentRemoteTitle = nil
            self.currentSourceView = nil
            self.pictureInPictureController = nil
            self.videoCallController.resetLocal(hasVideo: false)
            self.videoCallController.resetRemote(hasVideo: false)
            self.videoCallController.setTitles(localTitle: nil, remoteTitle: nil)
        }
    }

    private func observeAppLifecycle() {
        guard !didObserveAppLifecycle else { return }
        didObserveAppLifecycle = true
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillResignActive),
            name: UIApplication.willResignActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        print("[CallKit] Picture in Picture observing app lifecycle")
    }

    private func prepareControllerIfPossible() {
        guard AVPictureInPictureController.isPictureInPictureSupported() else {
            print("[CallKit] Picture in Picture unsupported on this device")
            return
        }
        guard let sourceView = sourceViewProvider() else {
            print("[CallKit] Picture in Picture source view unavailable")
            return
        }

        if pictureInPictureController != nil, currentSourceView === sourceView {
            print("[CallKit] Picture in Picture controller already prepared sourceView=\(type(of: sourceView)) hidden=\(sourceView.isHidden) window=\(sourceView.window != nil) possible=\(pictureInPictureController?.isPictureInPicturePossible ?? false)")
            return
        }

        currentSourceView = sourceView
        videoCallController.loadViewIfNeeded()
        let contentSource = AVPictureInPictureController.ContentSource(
            activeVideoCallSourceView: sourceView,
            contentViewController: videoCallController
        )
        let controller = AVPictureInPictureController(contentSource: contentSource)
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        controller.delegate = self
        pictureInPictureController = controller
        print("[CallKit] Picture in Picture controller prepared sourceView=\(type(of: sourceView)) hidden=\(sourceView.isHidden) window=\(sourceView.window != nil) localTitle=\(currentLocalTitle ?? "nil") localTrack=\(currentLocalTrack != nil) remoteTitle=\(currentRemoteTitle ?? "nil") remoteTrack=\(currentRemoteTrack != nil) possible=\(controller.isPictureInPicturePossible)")
    }

    @objc private func appWillResignActive() {
        DispatchQueue.main.async { [weak self] in
            print("[CallKit] Picture in Picture app will resign active")
            self?.startPictureInPictureIfPossible(reason: "willResignActive")
        }
    }

    @objc private func appDidEnterBackground() {
        DispatchQueue.main.async { [weak self] in
            print("[CallKit] Picture in Picture app did enter background")
            self?.startPictureInPictureIfPossible(reason: "didEnterBackground")
        }
    }

    private func startPictureInPictureIfPossible(reason: String) {
        prepareControllerIfPossible()

        guard let controller = pictureInPictureController else { return }
        guard !controller.isPictureInPictureActive else { return }
        guard controller.isPictureInPicturePossible else {
            print("[CallKit] Picture in Picture not possible reason=\(reason) localTitle=\(currentLocalTitle ?? "nil") localTrack=\(currentLocalTrack != nil) remoteTitle=\(currentRemoteTitle ?? "nil") remoteTrack=\(currentRemoteTrack != nil)")
            return
        }

        print("[CallKit] Starting Picture in Picture reason=\(reason) localTitle=\(currentLocalTitle ?? "nil") localTrack=\(currentLocalTrack != nil) remoteTitle=\(currentRemoteTitle ?? "nil") remoteTrack=\(currentRemoteTrack != nil)")
        controller.startPictureInPicture()
    }

    private func normalizedTitle(_ title: String?) -> String? {
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    func pictureInPictureControllerWillStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        print("[CallKit] Picture in Picture will start")
    }

    func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        print("[CallKit] Picture in Picture did start")
    }

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        failedToStartPictureInPictureWithError error: Error
    ) {
        print("[CallKit] Picture in Picture failed to start error=\(error)")
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        print("[CallKit] Picture in Picture did stop")
    }

    func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void
    ) {
        print("[CallKit] Picture in Picture restore requested")
        onRestore()
        completionHandler(true)
    }
}

@available(iOS 15.0, *)
private final class CallPiPVideoCallViewController: AVPictureInPictureVideoCallViewController, @unchecked Sendable {
    private lazy var contentView = CallPiPContentView()

    override func loadView() {
        view = contentView
        preferredContentSize = CGSize(width: 320, height: 150)
    }

    func setTitles(localTitle: String?, remoteTitle: String?) {
        contentView.localView.setParticipantTitle(localTitle ?? "You")
        contentView.remoteView.setParticipantTitle(remoteTitle ?? "No one else is here")
    }

    func resetLocal(hasVideo: Bool) {
        contentView.localView.reset(hasVideo: hasVideo)
    }

    func resetRemote(hasVideo: Bool) {
        contentView.remoteView.reset(hasVideo: hasVideo)
    }

    func setLocalTrack(_ track: VideoTrack?) {
        contentView.localView.setTrack(track)
    }

    func setRemoteTrack(_ track: VideoTrack?) {
        contentView.remoteView.setTrack(track)
    }
}

private final class CallPiPContentView: UIView {
    let localView = CallPiPParticipantView(isMirrored: true)
    let remoteView = CallPiPParticipantView(isMirrored: false)
    private let dividerView = UIView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(white: 0.06, alpha: 1)

        localView.translatesAutoresizingMaskIntoConstraints = false
        remoteView.translatesAutoresizingMaskIntoConstraints = false
        dividerView.backgroundColor = UIColor.white.withAlphaComponent(0.18)
        dividerView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(localView)
        addSubview(remoteView)
        addSubview(dividerView)

        NSLayoutConstraint.activate([
            localView.leadingAnchor.constraint(equalTo: leadingAnchor),
            localView.topAnchor.constraint(equalTo: topAnchor),
            localView.bottomAnchor.constraint(equalTo: bottomAnchor),
            localView.widthAnchor.constraint(equalTo: widthAnchor, multiplier: 0.5),
            remoteView.leadingAnchor.constraint(equalTo: localView.trailingAnchor),
            remoteView.trailingAnchor.constraint(equalTo: trailingAnchor),
            remoteView.topAnchor.constraint(equalTo: topAnchor),
            remoteView.bottomAnchor.constraint(equalTo: bottomAnchor),
            dividerView.centerXAnchor.constraint(equalTo: centerXAnchor),
            dividerView.topAnchor.constraint(equalTo: topAnchor),
            dividerView.bottomAnchor.constraint(equalTo: bottomAnchor),
            dividerView.widthAnchor.constraint(equalToConstant: 1),
        ])
        localView.setParticipantTitle("You")
        remoteView.setParticipantTitle("No one else is here")
    }

    required init?(coder: NSCoder) {
        nil
    }
}

private final class CallPiPParticipantView: UIView {
    private let videoView = VideoView()
    private let placeholderView = UIView()
    private let initialsLabel = UILabel()
    private let nameLabel = UILabel()

    init(frame: CGRect = .zero, isMirrored: Bool) {
        super.init(frame: frame)
        backgroundColor = UIColor(white: 0.06, alpha: 1)

        videoView.layoutMode = .fill
        videoView.renderMode = .sampleBuffer
        videoView.mirrorMode = isMirrored ? .auto : .off
        videoView.backgroundColor = UIColor(white: 0.06, alpha: 1)
        videoView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(videoView)

        placeholderView.backgroundColor = UIColor(white: 0.06, alpha: 1)
        placeholderView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(placeholderView)

        initialsLabel.textAlignment = .center
        initialsLabel.textColor = .white
        initialsLabel.backgroundColor = UIColor(white: 0.18, alpha: 1)
        initialsLabel.font = .systemFont(ofSize: 20, weight: .semibold)
        initialsLabel.layer.cornerRadius = 22
        initialsLabel.layer.masksToBounds = true
        initialsLabel.clipsToBounds = true
        initialsLabel.translatesAutoresizingMaskIntoConstraints = false
        placeholderView.addSubview(initialsLabel)

        nameLabel.textAlignment = .center
        nameLabel.textColor = UIColor.white.withAlphaComponent(0.88)
        nameLabel.font = .systemFont(ofSize: 10, weight: .medium)
        nameLabel.numberOfLines = 2
        nameLabel.translatesAutoresizingMaskIntoConstraints = false
        placeholderView.addSubview(nameLabel)

        NSLayoutConstraint.activate([
            videoView.leadingAnchor.constraint(equalTo: leadingAnchor),
            videoView.trailingAnchor.constraint(equalTo: trailingAnchor),
            videoView.topAnchor.constraint(equalTo: topAnchor),
            videoView.bottomAnchor.constraint(equalTo: bottomAnchor),
            placeholderView.leadingAnchor.constraint(equalTo: leadingAnchor),
            placeholderView.trailingAnchor.constraint(equalTo: trailingAnchor),
            placeholderView.topAnchor.constraint(equalTo: topAnchor),
            placeholderView.bottomAnchor.constraint(equalTo: bottomAnchor),
            initialsLabel.centerXAnchor.constraint(equalTo: placeholderView.centerXAnchor),
            initialsLabel.centerYAnchor.constraint(equalTo: placeholderView.centerYAnchor, constant: -7),
            initialsLabel.widthAnchor.constraint(equalToConstant: 44),
            initialsLabel.heightAnchor.constraint(equalToConstant: 44),
            nameLabel.leadingAnchor.constraint(greaterThanOrEqualTo: placeholderView.leadingAnchor, constant: 8),
            nameLabel.trailingAnchor.constraint(lessThanOrEqualTo: placeholderView.trailingAnchor, constant: -8),
            nameLabel.topAnchor.constraint(equalTo: initialsLabel.bottomAnchor, constant: 5),
            nameLabel.centerXAnchor.constraint(equalTo: placeholderView.centerXAnchor),
        ])
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        initialsLabel.layer.cornerRadius = initialsLabel.bounds.width / 2
        initialsLabel.layer.masksToBounds = true
        initialsLabel.clipsToBounds = true
    }

    func setParticipantTitle(_ title: String?) {
        let displayTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedTitle = displayTitle?.isEmpty == false ? displayTitle! : "Call"
        initialsLabel.text = initials(from: resolvedTitle)
        nameLabel.text = resolvedTitle
    }

    func setTrack(_ track: VideoTrack?) {
        videoView.track = track
        setHasVideo(track != nil)
    }

    func setHasVideo(_ hasVideo: Bool) {
        videoView.isHidden = !hasVideo
        placeholderView.isHidden = hasVideo
    }

    func reset(hasVideo: Bool) {
        if !hasVideo {
            videoView.track = nil
        }
        setHasVideo(hasVideo)
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
}
