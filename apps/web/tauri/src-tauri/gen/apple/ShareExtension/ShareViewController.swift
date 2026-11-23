import ImageIO
import UIKit
import UniformTypeIdentifiers
import os

/// Counts and outcomes only: shared content and file names stay out of the log.
private let log = Logger(subsystem: "com.macro.app.prod.ShareExtension", category: "share")

class ShareViewController: UIViewController {

    private let appGroupId = "group.com.macro.app.prod"
    private let appURLScheme = "macro"
    /// How long to wait for iOS to report whether it opened Macro before
    /// telling the person to open it themselves.
    private let openResultTimeout: TimeInterval = 5
    /// Files are written here first and get their `share_` name in the
    /// container only once complete, so the app never sees a partial file.
    private let incomingDirectoryName = "incoming"
    private var timeoutWorkItem: DispatchWorkItem?
    private var didComplete = false
    private var didAbandon = false
    private var didFinishOpening = false
    private var hostEnteredBackground = false
    private var handedOffFilenames: [String] = []
    private var writtenFilenames: [String] = []
    private let writtenLock = NSLock()

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        // A fully transparent view can cause the system to dismiss the extension
        // before it has a chance to do anything. Use a near-transparent scrim instead.
        view.backgroundColor = UIColor.black.withAlphaComponent(0.01)

        // The host app goes to the background when Macro takes the foreground.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(hostDidEnterBackground),
            name: .NSExtensionHostDidEnterBackground,
            object: nil
        )

        scheduleTimeout()
        processSharedItems()
    }

    // MARK: - Main flow

    private func processSharedItems() {
        guard
            let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
            let attachments = extensionItem.attachments,
            !attachments.isEmpty
        else {
            log.error("share has no attachments")
            complete()
            return
        }
        log.info("share started attachments=\(attachments.count, privacy: .public)")

        let group = DispatchGroup()
        var savedFilenames = Array<String?>(repeating: nil, count: attachments.count)
        let lock = NSLock()

        for (index, provider) in attachments.enumerated() {
            let urlType = UTType.url.identifier

            if let imageType = mediaTypeIdentifier(from: provider, conformingTo: .image) {
                group.enter()
                loadImage(from: provider, typeIdentifier: imageType) { name in
                    defer { group.leave() }
                    if let name = name {
                        lock.withLock { savedFilenames[index] = name }
                    }
                }
            } else if let movieType = mediaTypeIdentifier(from: provider, conformingTo: .movie) {
                group.enter()
                loadMovie(from: provider, typeIdentifier: movieType) { name in
                    defer { group.leave() }
                    if let name = name {
                        lock.withLock { savedFilenames[index] = name }
                    }
                }
            } else if provider.hasItemConformingToTypeIdentifier(urlType) {
                group.enter()
                loadURLData(from: provider, typeIdentifier: urlType) { [weak self] data in
                    defer { group.leave() }
                    if let data = data, let name = self?.saveToAppGroup(data: data, ext: "url") {
                        lock.withLock { savedFilenames[index] = name }
                    }
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }
            guard !self.didAbandon else {
                self.removeWrittenFiles()
                return
            }
            let handedOff = self.handOff(savedFilenames.compactMap { $0 })
            log.info(
                "share saved files=\(handedOff.count, privacy: .public) of \(attachments.count, privacy: .public)"
            )
            if handedOff.isEmpty {
                self.showCouldNotRead()
            } else {
                self.openMainApp(filenames: handedOff)
            }
        }
    }

    // MARK: - Data loading

    private func loadImage(
        from provider: NSItemProvider,
        typeIdentifier: String,
        completion: @escaping (String?) -> Void
    ) {
        provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { [weak self] url, _ in
            guard let self = self else {
                completion(nil)
                return
            }

            if let url = url {
                completion(self.saveImageToAppGroup(sourceURL: url, typeIdentifier: typeIdentifier))
                return
            }

            self.loadImageItemFallback(from: provider, typeIdentifier: typeIdentifier, completion: completion)
        }
    }

    private func loadMovie(
        from provider: NSItemProvider,
        typeIdentifier: String,
        completion: @escaping (String?) -> Void
    ) {
        provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { [weak self] url, _ in
            guard let self = self else {
                completion(nil)
                return
            }

            if let url = url {
                completion(self.saveMovieToAppGroup(sourceURL: url, typeIdentifier: typeIdentifier))
                return
            }

            provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, _ in
                completion(self.saveMovieItemFallback(item, typeIdentifier: typeIdentifier))
            }
        }
    }

    private func loadURLData(
        from provider: NSItemProvider,
        typeIdentifier: String,
        completion: @escaping (Data?) -> Void
    ) {
        provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, _ in
            let url: URL?
            if let itemURL = item as? URL {
                url = itemURL
            } else if let itemString = item as? String {
                url = URL(string: itemString)
            } else if let itemData = item as? Data,
                      let itemString = String(data: itemData, encoding: .utf8) {
                url = URL(string: itemString.trimmingCharacters(in: .whitespacesAndNewlines))
            } else {
                url = nil
            }

            completion(url?.absoluteString.appending("\n").data(using: .utf8))
        }
    }

    // MARK: - App Group storage

    private func saveImageToAppGroup(sourceURL: URL, typeIdentifier: String) -> String? {
        let type = imageType(typeIdentifier: typeIdentifier, sourceURL: sourceURL)
        let shouldConvertToJpeg = isHeicOrHeif(type: type, sourceURL: sourceURL)
        let ext = shouldConvertToJpeg
            ? "jpg"
            : preferredFilenameExtension(type: type, sourceURL: sourceURL, fallback: "jpg")

        guard let target = makeAppGroupFileURL(ext: ext) else {
            return nil
        }

        do {
            if shouldConvertToJpeg {
                try writeJpegImageUsingImageIO(from: sourceURL, to: target.url)
            } else {
                try copyFile(sourceURL, to: target.url)
            }
            return target.filename
        } catch {
            return nil
        }
    }

    private func saveMovieToAppGroup(sourceURL: URL, typeIdentifier: String) -> String? {
        let type = mediaType(typeIdentifier: typeIdentifier, sourceURL: sourceURL)
        let ext = preferredFilenameExtension(type: type, sourceURL: sourceURL, fallback: "mov")

        guard let target = makeAppGroupFileURL(ext: ext) else {
            return nil
        }

        do {
            try copyFile(sourceURL, to: target.url)
            return target.filename
        } catch {
            return nil
        }
    }

    private func saveToAppGroup(data: Data, ext: String) -> String? {
        guard let target = makeAppGroupFileURL(ext: ext) else {
            return nil
        }

        do {
            try data.write(to: target.url, options: [.atomic])
            return target.filename
        } catch {
            return nil
        }
    }

    // MARK: - Opening the main app

    private func openMainApp(filenames: [String]) {
        var components = URLComponents()
        components.scheme = appURLScheme
        components.host = "share"
        components.queryItems = [
            URLQueryItem(name: "files", value: filenames.joined(separator: ","))
        ]

        guard let url = components.url else {
            complete()
            return
        }

        // Saving is done; from here only the open's own timeout applies.
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil
        handedOffFilenames = filenames

        // There is no public API for a share extension to open its app.
        // `UIApplication` reached through the responder chain is what works in
        // practice; `extensionContext.open` is documented for other extension
        // types only. Either can be refused, so wait for the result: finishing
        // the request first tears this process down before iOS acts on it.
        var responder: UIResponder? = self
        while let current = responder, !(current is UIApplication) {
            responder = current.next
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + openResultTimeout) { [weak self] in
            self?.finishOpening(opened: false, via: "timeout")
        }

        if let application = responder as? UIApplication {
            application.open(url, options: [:]) { [weak self] opened in
                DispatchQueue.main.async {
                    self?.finishOpening(opened: opened, via: "application")
                }
            }
        } else if let extensionContext {
            extensionContext.open(url) { [weak self] opened in
                DispatchQueue.main.async {
                    self?.finishOpening(opened: opened, via: "extension_context")
                }
            }
        } else {
            finishOpening(opened: false, via: "unavailable")
        }
    }

    /// The files stay in the App Group container, so when iOS won't open Macro
    /// the share still appears the next time the person opens it.
    private func finishOpening(opened reportedOpened: Bool, via route: String) {
        guard !didFinishOpening else { return }
        didFinishOpening = true
        // Without an answer, Macro still counts as opened when the host app
        // went to the background or Macro already took the files: a card here
        // would sit over the share sheet saying the opposite.
        let opened = reportedOpened || hostEnteredBackground || macroTookFiles()
        log.info(
            "open macro opened=\(opened, privacy: .public) reported=\(reportedOpened, privacy: .public) via=\(route, privacy: .public)"
        )
        if opened {
            complete()
        } else {
            showMessage(
                NSLocalizedString(
                    "Saved. Open Macro to finish sharing.",
                    comment: "Share extension: iOS did not open Macro; the share waits in the app"
                )
            )
        }
    }

    // MARK: - Message

    /// A small card over the host app, for when the extension can't hand the
    /// share to Macro by itself. It replaces the silent dismissal that looked
    /// like nothing happened.
    private func showMessage(_ text: String) {
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil

        let card = UIView()
        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 16
        card.translatesAutoresizingMaskIntoConstraints = false

        let label = UILabel()
        label.text = text
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = .label
        label.textAlignment = .center
        label.numberOfLines = 0

        let done = UIButton(type: .system)
        done.setTitle(NSLocalizedString("Done", comment: "Share extension: dismiss the message"), for: .normal)
        done.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        done.titleLabel?.adjustsFontForContentSizeCategory = true
        done.addTarget(self, action: #selector(doneTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [label, done])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        view.addSubview(card)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: view.layoutMarginsGuide.leadingAnchor),
            card.widthAnchor.constraint(lessThanOrEqualToConstant: 320),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
        ])
        let preferredWidth = card.widthAnchor.constraint(equalToConstant: 320)
        preferredWidth.priority = .defaultHigh
        preferredWidth.isActive = true

        UIView.animate(withDuration: 0.2) {
            self.view.backgroundColor = UIColor.black.withAlphaComponent(0.3)
        }
    }

    private func showCouldNotRead() {
        showMessage(
            NSLocalizedString(
                "Macro couldn't read this item.",
                comment: "Share extension: nothing could be saved from the shared item"
            )
        )
    }

    @objc private func doneTapped() {
        complete()
    }

    @objc private func hostDidEnterBackground() {
        hostEnteredBackground = true
    }

    // MARK: - Helpers

    private func mediaTypeIdentifier(from provider: NSItemProvider, conformingTo type: UTType) -> String? {
        let preferredTypes = type.conforms(to: .image)
            ? preferredImageTypes()
            : preferredMovieTypes()
        return preferredTypeIdentifier(
            from: provider,
            preferredTypes: preferredTypes,
            fallbackType: type
        )
    }

    private func preferredImageTypes() -> [UTType] {
        ["jpg", "png", "heic", "heif", "webp", "gif"].compactMap {
            UTType(filenameExtension: $0)
        }
    }

    private func preferredMovieTypes() -> [UTType] {
        ["mov", "mp4"].compactMap {
            UTType(filenameExtension: $0)
        }
    }

    private func preferredTypeIdentifier(
        from provider: NSItemProvider,
        preferredTypes: [UTType],
        fallbackType: UTType
    ) -> String? {
        let concreteRegisteredTypes = provider.registeredTypeIdentifiers.compactMap { identifier -> (String, UTType)? in
            guard identifier != fallbackType.identifier, let type = UTType(identifier) else {
                return nil
            }
            return (identifier, type)
        }

        for preferredType in preferredTypes {
            if let match = concreteRegisteredTypes.first(where: { $0.1.conforms(to: preferredType) }) {
                return match.0
            }
            if provider.hasItemConformingToTypeIdentifier(preferredType.identifier) {
                return preferredType.identifier
            }
        }

        if let match = concreteRegisteredTypes.first(where: { $0.1.conforms(to: fallbackType) }) {
            return match.0
        }

        return provider.hasItemConformingToTypeIdentifier(fallbackType.identifier)
            ? fallbackType.identifier
            : nil
    }

    private func imageType(typeIdentifier: String, sourceURL: URL) -> UTType? {
        if let sourceType = imageSourceType(from: sourceURL) {
            return sourceType
        }
        return mediaType(typeIdentifier: typeIdentifier, sourceURL: sourceURL)
    }

    private func imageType(typeIdentifier: String, data: Data) -> UTType? {
        if let sourceType = imageSourceType(from: data) {
            return sourceType
        }
        return UTType(typeIdentifier)
    }

    private func mediaType(typeIdentifier: String, sourceURL: URL) -> UTType? {
        if let type = UTType(typeIdentifier) {
            return type
        }
        if let type = UTType(filenameExtension: sourceURL.pathExtension) {
            return type
        }
        return nil
    }

    private func imageSourceType(from sourceURL: URL) -> UTType? {
        guard
            let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
            let typeIdentifier = CGImageSourceGetType(source)
        else {
            return nil
        }

        return UTType(typeIdentifier as String)
    }

    private func imageSourceType(from data: Data) -> UTType? {
        guard
            let source = CGImageSourceCreateWithData(data as CFData, nil),
            let typeIdentifier = CGImageSourceGetType(source)
        else {
            return nil
        }

        return UTType(typeIdentifier as String)
    }

    private func preferredFilenameExtension(type: UTType?, sourceURL: URL, fallback: String) -> String {
        if let ext = type?.preferredFilenameExtension, !ext.isEmpty {
            return ext
        }
        if !sourceURL.pathExtension.isEmpty {
            return sourceURL.pathExtension
        }
        return fallback
    }

    private func isHeicOrHeif(type: UTType?, sourceURL: URL) -> Bool {
        let heicType = UTType(filenameExtension: "heic")
        let heifType = UTType(filenameExtension: "heif")
        if let type = type {
            if let heicType = heicType, type.conforms(to: heicType) {
                return true
            }
            if let heifType = heifType, type.conforms(to: heifType) {
                return true
            }
        }

        switch sourceURL.pathExtension.lowercased() {
        case "heic", "heif":
            return true
        default:
            return false
        }
    }

    private func loadImageItemFallback(
        from provider: NSItemProvider,
        typeIdentifier: String,
        completion: @escaping (String?) -> Void
    ) {
        provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { [weak self] item, _ in
            completion(self?.saveImageItemFallback(item, typeIdentifier: typeIdentifier))
        }
    }

    private func saveImageItemFallback(_ item: NSSecureCoding?, typeIdentifier: String) -> String? {
        if let url = item as? URL, url.isFileURL {
            return saveImageToAppGroup(sourceURL: url, typeIdentifier: typeIdentifier)
        }

        if let image = item as? UIImage {
            return saveUIImageToAppGroup(image)
        }

        if let data = item as? Data {
            let type = imageType(typeIdentifier: typeIdentifier, data: data)
            if isHeicOrHeif(type: type, sourceURL: URL(fileURLWithPath: "")) {
                return saveHeicDataAsJpegToAppGroup(data)
            }

            let ext = preferredFilenameExtension(type: type, sourceURL: URL(fileURLWithPath: ""), fallback: "jpg")
            return saveToAppGroup(data: data, ext: ext)
        }

        return nil
    }

    private func saveMovieItemFallback(_ item: NSSecureCoding?, typeIdentifier: String) -> String? {
        if let url = item as? URL, url.isFileURL {
            return saveMovieToAppGroup(sourceURL: url, typeIdentifier: typeIdentifier)
        }

        if let data = item as? Data {
            let ext = preferredFilenameExtension(
                type: UTType(typeIdentifier),
                sourceURL: URL(fileURLWithPath: ""),
                fallback: "mov"
            )
            return saveToAppGroup(data: data, ext: ext)
        }

        return nil
    }

    private func saveUIImageToAppGroup(_ image: UIImage) -> String? {
        if imageHasAlpha(image), let data = image.pngData() {
            return saveToAppGroup(data: data, ext: "png")
        }

        guard let data = image.jpegData(compressionQuality: 0.92) else {
            return nil
        }
        return saveToAppGroup(data: data, ext: "jpg")
    }

    private func saveHeicDataAsJpegToAppGroup(_ data: Data) -> String? {
        guard let target = makeAppGroupFileURL(ext: "jpg") else {
            return nil
        }

        do {
            try writeJpegImageUsingImageIO(from: data, to: target.url)
            return target.filename
        } catch {
            return nil
        }
    }

    /// A new file in the incoming folder; `handOff` gives it to the app.
    private func makeAppGroupFileURL(ext: String) -> (filename: String, url: URL)? {
        guard let container = appGroupContainer() else {
            return nil
        }
        let incoming = container.appendingPathComponent(incomingDirectoryName, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: incoming, withIntermediateDirectories: true)
        } catch {
            return nil
        }

        let normalizedExt = normalizedFilenameExtension(ext)
        let filename = "share_\(UUID().uuidString).\(normalizedExt)"
        writtenLock.withLock { writtenFilenames.append(filename) }
        return (filename, incoming.appendingPathComponent(filename))
    }

    private func appGroupContainer() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId)
    }

    /// Moves finished files from the incoming folder to their `share_` names,
    /// stamping each with the time it was shared: the app ignores shared files
    /// older than a day, and a copy keeps its source's modification time.
    /// Returns the files the app can now see, in order.
    private func handOff(_ filenames: [String]) -> [String] {
        guard let container = appGroupContainer() else { return [] }
        let incoming = container.appendingPathComponent(incomingDirectoryName, isDirectory: true)
        let fileManager = FileManager.default
        var handedOff: [String] = []
        for filename in filenames {
            let source = incoming.appendingPathComponent(filename)
            do {
                try fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: source.path)
                try fileManager.moveItem(at: source, to: container.appendingPathComponent(filename))
                handedOff.append(filename)
            } catch {
                log.error("failed to hand off a shared file")
                try? fileManager.removeItem(at: source)
            }
        }
        writtenLock.withLock { writtenFilenames.removeAll() }
        return handedOff
    }

    /// True once the app has moved every handed-off file out of the container.
    private func macroTookFiles() -> Bool {
        guard let container = appGroupContainer(), !handedOffFilenames.isEmpty else {
            return false
        }
        return handedOffFilenames.allSatisfy { filename in
            !FileManager.default.fileExists(atPath: container.appendingPathComponent(filename).path)
        }
    }

    private func removeWrittenFiles() {
        guard let container = appGroupContainer() else { return }
        let incoming = container.appendingPathComponent(incomingDirectoryName, isDirectory: true)
        let filenames = writtenLock.withLock { () -> [String] in
            let filenames = writtenFilenames
            writtenFilenames.removeAll()
            return filenames
        }
        for filename in filenames {
            try? FileManager.default.removeItem(at: incoming.appendingPathComponent(filename))
        }
    }

    private func normalizedFilenameExtension(_ ext: String) -> String {
        let raw = ext
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
            .lowercased()
        let filtered = raw.filter { character in
            character.isLetter || character.isNumber
        }
        return filtered.isEmpty ? "bin" : String(filtered)
    }

    private func copyFile(_ sourceURL: URL, to targetURL: URL) throws {
        if FileManager.default.fileExists(atPath: targetURL.path) {
            try FileManager.default.removeItem(at: targetURL)
        }
        try FileManager.default.copyItem(at: sourceURL, to: targetURL)
    }

    private func writeJpegImageUsingImageIO(from sourceURL: URL, to targetURL: URL) throws {
        guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil) else {
            throw shareExtensionError("Failed to create image source", code: 1)
        }
        try writeJpegImageSourceUsingImageIO(source, to: targetURL)
    }

    private func writeJpegImageUsingImageIO(from data: Data, to targetURL: URL) throws {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
            throw shareExtensionError("Failed to create image source", code: 2)
        }
        try writeJpegImageSourceUsingImageIO(source, to: targetURL)
    }

    private func writeJpegImageSourceUsingImageIO(_ source: CGImageSource, to targetURL: URL) throws {
        guard CGImageSourceGetCount(source) > 0 else {
            throw shareExtensionError("Shared image did not contain an image", code: 3)
        }

        guard let destination = CGImageDestinationCreateWithURL(
            targetURL as CFURL,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            throw shareExtensionError("Failed to create JPEG destination", code: 4)
        }

        guard let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw shareExtensionError("Failed to decode shared image", code: 5)
        }

        let sourceProperties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let destinationProperties: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: 0.92,
        ].merging(sourceProperties ?? [:]) { compressionQuality, _ in
            compressionQuality
        }

        CGImageDestinationAddImage(destination, image, destinationProperties as CFDictionary)

        guard CGImageDestinationFinalize(destination) else {
            throw shareExtensionError("Failed to encode shared image as JPEG", code: 6)
        }
    }

    private func shareExtensionError(_ message: String, code: Int) -> NSError {
        NSError(
            domain: "ShareExtension",
            code: code,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }

    private func imageHasAlpha(_ image: UIImage) -> Bool {
        guard let alphaInfo = image.cgImage?.alphaInfo else { return false }
        switch alphaInfo {
        case .first, .last, .premultipliedFirst, .premultipliedLast:
            return true
        default:
            return false
        }
    }

    /// Gives up on items that take too long to load. Nothing written so far
    /// reaches the app, and the person is told rather than left guessing.
    private func scheduleTimeout() {
        let workItem = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            log.error("share timed out loading items")
            self.didAbandon = true
            self.removeWrittenFiles()
            self.showCouldNotRead()
        }
        timeoutWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: workItem)
    }

    private func complete() {
        guard !didComplete else { return }
        didComplete = true
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
