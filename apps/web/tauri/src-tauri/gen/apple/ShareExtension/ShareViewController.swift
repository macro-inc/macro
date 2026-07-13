import ImageIO
import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {

    private let appGroupId = "group.com.macro.app.prod"
    private let appURLScheme = "macro"
    private var timeoutWorkItem: DispatchWorkItem?
    private var didComplete = false

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        // A fully transparent view can cause the system to dismiss the extension
        // before it has a chance to do anything. Use a near-transparent scrim instead.
        view.backgroundColor = UIColor.black.withAlphaComponent(0.01)

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
            complete()
            return
        }

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
            let orderedFilenames = savedFilenames.compactMap { $0 }
            if orderedFilenames.isEmpty {
                self.complete()
            } else {
                self.openMainApp(filenames: orderedFilenames)
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

        // Walk up the responder chain looking for the UIApplication instance.
        var foundViaChain = false
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                app.open(url, options: [:], completionHandler: nil)
                foundViaChain = true
                break
            }
            responder = r.next
        }

        // Fallback: use extensionContext to open the URL.
        // UIApplication.shared is unavailable in extensions; extensionContext?.open
        // is the supported API for launching the host app from any extension type.
        if !foundViaChain {
            extensionContext?.open(url, completionHandler: nil)
        }

        complete()
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

    private func makeAppGroupFileURL(ext: String) -> (filename: String, url: URL)? {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        ) else {
            return nil
        }

        let normalizedExt = normalizedFilenameExtension(ext)
        let filename = "share_\(UUID().uuidString).\(normalizedExt)"
        return (filename, container.appendingPathComponent(filename))
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

    private func scheduleTimeout() {
        let workItem = DispatchWorkItem { [weak self] in
            self?.complete()
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
