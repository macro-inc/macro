import ImageIO
import PhotosUI
import Tauri
import UIKit
import UniformTypeIdentifiers

private let maxPhotoLibrarySelectionCount = 10

private struct PickPhotoLibraryImagesPayload: Decodable {
    let stagingDirectoryPath: String
    let tokenPrefix: String
}

class UnavailablePhotoLibraryPlugin: Plugin {
    @objc public func pickPhotoLibraryImages(_ invoke: Invoke) {
        invoke.reject("Photo library media picker requires iOS 14 or newer")
    }
}

@available(iOS 14.0, *)
class PhotoLibraryPlugin: Plugin {
    private var pickerDelegate: PhotoLibraryPickerDelegate?
    private weak var presentedPicker: PHPickerViewController?

    @objc public func pickPhotoLibraryImages(_ invoke: Invoke) throws {
        let payload = try invoke.parseArgs(PickPhotoLibraryImagesPayload.self)
        let stagingDirectory = URL(
            fileURLWithPath: payload.stagingDirectoryPath,
            isDirectory: true
        )

        DispatchQueue.main.async {
            if let activePicker = self.presentedPicker,
                activePicker.isBeingPresented || activePicker.presentingViewController != nil
            {
                invoke.reject("Photo library picker is already open")
                return
            }
            // A lingering delegate whose picker is no longer on screen means
            // the previous session ended without a delegate callback (the
            // sheet can be dismissed without one); drop it so the picker can
            // open again instead of being stuck "already open".
            self.pickerDelegate = nil

            // `manager.viewController` is a singleton set through an FFI
            // callback and has been observed nil in archive builds; fall back
            // to the key window so the picker can still present.
            guard
                let rootViewController = self.manager.viewController
                    ?? keyWindowRootViewController()
            else {
                invoke.reject("No view controller available to present photo library")
                return
            }

            guard let viewController = topmostPresentableViewController(from: rootViewController) else {
                invoke.reject("Photo library picker cannot be presented right now")
                return
            }

            var configuration = PHPickerConfiguration(photoLibrary: .shared())
            configuration.filter = .any(of: [.images, .videos])
            configuration.preferredAssetRepresentationMode = .current
            configuration.selectionLimit = maxPhotoLibrarySelectionCount

            let picker = PHPickerViewController(configuration: configuration)
            let delegate = PhotoLibraryPickerDelegate(
                plugin: self,
                invoke: invoke,
                stagingDirectory: stagingDirectory,
                tokenPrefix: payload.tokenPrefix,
                onComplete: { [weak self] finishedDelegate in
                    // A stale session may complete after a newer picker was
                    // opened; only clear the delegate it still owns.
                    if self?.pickerDelegate === finishedDelegate {
                        self?.pickerDelegate = nil
                    }
                }
            )
            self.pickerDelegate = delegate
            picker.delegate = delegate
            self.presentedPicker = picker

            viewController.present(picker, animated: true)
        }
    }

    fileprivate func stageMediaFile(
        sourceURL: URL,
        typeIdentifier: String?,
        suggestedName: String?,
        mediaKind: PhotoLibraryMediaKind,
        stagingDirectory: URL,
        tokenPrefix: String
    ) throws -> StagedPhotoLibraryMedia {
        let sourceType: UTType?
        if mediaKind == .image {
            sourceType = imageType(typeIdentifier: typeIdentifier, sourceURL: sourceURL)
        } else {
            sourceType = mediaType(typeIdentifier: typeIdentifier, sourceURL: sourceURL)
        }
        let shouldConvertToJpeg =
            mediaKind == .image && isHeicOrHeif(type: sourceType, sourceURL: sourceURL)
        let token = tokenPrefix
            + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let fileExtension = shouldConvertToJpeg
            ? "jpg"
            : preferredFilenameExtension(type: sourceType, sourceURL: sourceURL, mediaKind: mediaKind)
        let name = sanitizedMediaFilename(
            suggestedName,
            fileExtension: fileExtension,
            mediaKind: mediaKind
        )
        let targetURL = stagingDirectory.appendingPathComponent("\(token)-\(name)")

        try FileManager.default.createDirectory(
            at: stagingDirectory,
            withIntermediateDirectories: true
        )

        if FileManager.default.fileExists(atPath: targetURL.path) {
            try FileManager.default.removeItem(at: targetURL)
        }

        if shouldConvertToJpeg {
            try writeJpegImageUsingImageIO(from: sourceURL, to: targetURL)
        } else {
            try FileManager.default.copyItem(at: sourceURL, to: targetURL)
        }
        try FileManager.default.setAttributes(
            [.modificationDate: Date()],
            ofItemAtPath: targetURL.path
        )

        let size = try FileManager.default.attributesOfItem(
            atPath: targetURL.path
        )[.size] as? NSNumber

        return StagedPhotoLibraryMedia(
            token: token,
            name: name,
            mimeType: shouldConvertToJpeg
                ? "image/jpeg"
                : mimeType(
                    type: sourceType,
                    sourceURL: targetURL,
                    mediaKind: mediaKind
                ),
            size: size?.uint64Value ?? 0,
            previewPath: targetURL.path
        )
    }

    fileprivate func cleanupStalePhotoLibraryMedia(in directory: URL) {
        guard
            let entries = try? FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.contentModificationDateKey]
            )
        else { return }

        let cutoff = Date().addingTimeInterval(-60 * 60 * 24)
        for url in entries {
            let modified = (try? url.resourceValues(
                forKeys: [.contentModificationDateKey]
            ).contentModificationDate) ?? Date.distantFuture
            if modified < cutoff {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }
}

private enum PhotoLibraryMediaKind {
    case image
    case video
}

private struct PhotoLibraryMediaType {
    let identifier: String
    let kind: PhotoLibraryMediaKind
}

private struct StagedPhotoLibraryMedia: Encodable {
    let token: String
    let name: String
    let mimeType: String
    let size: UInt64
    let previewPath: String
}

@available(iOS 14.0, *)
private class PhotoLibraryPickerDelegate: NSObject, PHPickerViewControllerDelegate {
    private weak var plugin: PhotoLibraryPlugin?
    private let invoke: Invoke
    private let stagingDirectory: URL
    private let tokenPrefix: String
    private let onComplete: (PhotoLibraryPickerDelegate) -> Void

    init(
        plugin: PhotoLibraryPlugin,
        invoke: Invoke,
        stagingDirectory: URL,
        tokenPrefix: String,
        onComplete: @escaping (PhotoLibraryPickerDelegate) -> Void
    ) {
        self.plugin = plugin
        self.invoke = invoke
        self.stagingDirectory = stagingDirectory
        self.tokenPrefix = tokenPrefix
        self.onComplete = onComplete
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)

        guard !results.isEmpty else {
            invoke.resolve([StagedPhotoLibraryMedia]())
            onComplete(self)
            return
        }

        guard let plugin = plugin else {
            invoke.reject("Photo library plugin was released")
            onComplete(self)
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            plugin.cleanupStalePhotoLibraryMedia(in: self.stagingDirectory)

            let group = DispatchGroup()
            let lock = NSLock()
            var stagedMedia = Array<StagedPhotoLibraryMedia?>(
                repeating: nil,
                count: results.count
            )
            var firstError: String?

            for (index, result) in results.enumerated() {
                let provider = result.itemProvider
                guard let mediaType = mediaTypeIdentifier(from: provider) else {
                    continue
                }

                group.enter()
                provider.loadFileRepresentation(forTypeIdentifier: mediaType.identifier) { url, error in
                    defer { group.leave() }

                    if let error = error {
                        lock.lock()
                        firstError = firstError ?? error.localizedDescription
                        lock.unlock()
                        return
                    }

                    guard let url = url else {
                        lock.lock()
                        firstError = firstError ?? "Selected media did not provide a file"
                        lock.unlock()
                        return
                    }

                    do {
                        let staged = try plugin.stageMediaFile(
                            sourceURL: url,
                            typeIdentifier: mediaType.identifier,
                            suggestedName: provider.suggestedName,
                            mediaKind: mediaType.kind,
                            stagingDirectory: self.stagingDirectory,
                            tokenPrefix: self.tokenPrefix
                        )
                        lock.lock()
                        stagedMedia[index] = staged
                        lock.unlock()
                    } catch {
                        lock.lock()
                        firstError = firstError ?? error.localizedDescription
                        lock.unlock()
                    }
                }
            }

            group.notify(queue: .main) {
                let orderedStagedMedia = stagedMedia.compactMap { $0 }
                if !orderedStagedMedia.isEmpty {
                    self.invoke.resolve(orderedStagedMedia)
                } else if let firstError = firstError {
                    self.invoke.reject("Failed to stage photo library media: \(firstError)")
                } else {
                    self.invoke.resolve([StagedPhotoLibraryMedia]())
                }
                self.onComplete(self)
            }
        }
    }
}

@available(iOS 14.0, *)
private func keyWindowRootViewController() -> UIViewController? {
    let windows = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .filter { $0.activationState == .foregroundActive }
        .flatMap(\.windows)
    return (windows.first { $0.isKeyWindow } ?? windows.first)?.rootViewController
}

@available(iOS 14.0, *)
private func topmostPresentableViewController(from root: UIViewController) -> UIViewController? {
    var current = root

    while let presented = current.presentedViewController {
        if presented.isBeingDismissed || presented.isBeingPresented {
            return nil
        }
        current = presented
    }

    if current.isBeingDismissed || current.isBeingPresented || current.view.window == nil {
        return nil
    }

    return current
}

@available(iOS 14.0, *)
private func mediaTypeIdentifier(from provider: NSItemProvider) -> PhotoLibraryMediaType? {
    if let typeIdentifier = videoTypeIdentifier(from: provider) {
        return PhotoLibraryMediaType(identifier: typeIdentifier, kind: .video)
    }

    if let typeIdentifier = imageTypeIdentifier(from: provider) {
        return PhotoLibraryMediaType(identifier: typeIdentifier, kind: .image)
    }

    return nil
}

@available(iOS 14.0, *)
private func imageTypeIdentifier(from provider: NSItemProvider) -> String? {
    preferredTypeIdentifier(
        from: provider,
        preferredTypes: preferredImageTypes(),
        fallbackTypes: [.image]
    )
}

@available(iOS 14.0, *)
private func videoTypeIdentifier(from provider: NSItemProvider) -> String? {
    preferredTypeIdentifier(
        from: provider,
        preferredTypes: preferredVideoTypes(),
        fallbackTypes: [.movie, .video]
    )
}

@available(iOS 14.0, *)
private func preferredImageTypes() -> [UTType] {
    ["jpg", "png", "heic", "heif", "webp", "gif"].compactMap {
        UTType(filenameExtension: $0)
    }
}

@available(iOS 14.0, *)
private func preferredVideoTypes() -> [UTType] {
    var types = ["mp4", "mov", "m4v"].compactMap {
        UTType(filenameExtension: $0)
    }
    types.append(contentsOf: [.mpeg4Movie, .quickTimeMovie, .movie])
    return types
}

@available(iOS 14.0, *)
private func preferredTypeIdentifier(
    from provider: NSItemProvider,
    preferredTypes: [UTType],
    fallbackTypes: [UTType]
) -> String? {
    let fallbackIdentifiers = Set(fallbackTypes.map(\.identifier))
    let concreteRegisteredTypes = provider.registeredTypeIdentifiers.compactMap { identifier -> (String, UTType)? in
        guard !fallbackIdentifiers.contains(identifier), let type = UTType(identifier) else {
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

    for fallbackType in fallbackTypes {
        if let match = concreteRegisteredTypes.first(where: { $0.1.conforms(to: fallbackType) }) {
            return match.0
        }
    }

    for fallbackType in fallbackTypes {
        if provider.hasItemConformingToTypeIdentifier(fallbackType.identifier) {
            return fallbackType.identifier
        }
    }

    return nil
}

@available(iOS 14.0, *)
private func imageType(typeIdentifier: String?, sourceURL: URL) -> UTType? {
    if let sourceType = imageSourceType(from: sourceURL) {
        return sourceType
    }
    if let typeIdentifier = typeIdentifier, let type = UTType(typeIdentifier) {
        return type
    }
    if let type = UTType(filenameExtension: sourceURL.pathExtension) {
        return type
    }
    return nil
}

@available(iOS 14.0, *)
private func mediaType(typeIdentifier: String?, sourceURL: URL) -> UTType? {
    if let typeIdentifier = typeIdentifier, let type = UTType(typeIdentifier) {
        return type
    }
    if let type = UTType(filenameExtension: sourceURL.pathExtension) {
        return type
    }
    return nil
}

@available(iOS 14.0, *)
private func imageSourceType(from sourceURL: URL) -> UTType? {
    guard
        let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
        let typeIdentifier = CGImageSourceGetType(source)
    else {
        return nil
    }

    return UTType(typeIdentifier as String)
}

private func sanitizedMediaFilename(
    _ suggestedName: String?,
    fileExtension: String,
    mediaKind: PhotoLibraryMediaKind
) -> String {
    let fallback: String
    if mediaKind == .video {
        fallback = "photo-library-video"
    } else {
        fallback = "photo-library-image"
    }
    let rawName = suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines)
    let basename = rawName?.isEmpty == false ? rawName! : fallback
    let filename = URL(fileURLWithPath: basename).lastPathComponent
    let nameWithoutExtension = URL(fileURLWithPath: filename)
        .deletingPathExtension()
        .lastPathComponent
    let normalizedName = nameWithoutExtension.isEmpty ? fallback : nameWithoutExtension
    let normalizedExtension = fileExtension.trimmingCharacters(in: .whitespacesAndNewlines)
    let fallbackExtension = mediaKind == .video ? "mov" : "jpg"

    return "\(normalizedName).\(normalizedExtension.isEmpty ? fallbackExtension : normalizedExtension)"
}

@available(iOS 14.0, *)
private func preferredFilenameExtension(
    type: UTType?,
    sourceURL: URL,
    mediaKind: PhotoLibraryMediaKind
) -> String {
    if let fileExtension = type?.preferredFilenameExtension, !fileExtension.isEmpty {
        return fileExtension
    }
    if !sourceURL.pathExtension.isEmpty {
        return sourceURL.pathExtension
    }
    return mediaKind == .video ? "mov" : "jpg"
}

@available(iOS 14.0, *)
private func mimeType(
    type: UTType?,
    sourceURL: URL,
    mediaKind: PhotoLibraryMediaKind
) -> String {
    if let mimeType = type?.preferredMIMEType {
        return mimeType
    }

    switch sourceURL.pathExtension.lowercased() {
    case "jpg", "jpeg":
        return "image/jpeg"
    case "png":
        return "image/png"
    case "gif":
        return "image/gif"
    case "heic", "heif":
        return "image/heic"
    case "webp":
        return "image/webp"
    case "mov", "qt":
        return "video/quicktime"
    case "mp4":
        return "video/mp4"
    case "m4v":
        return "video/x-m4v"
    default:
        return mediaKind == .video ? "video/quicktime" : "application/octet-stream"
    }
}

@available(iOS 14.0, *)
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

private func photoLibraryError(_ message: String, code: Int) -> NSError {
    NSError(
        domain: "PhotoLibraryPlugin",
        code: code,
        userInfo: [NSLocalizedDescriptionKey: message]
    )
}

@available(iOS 14.0, *)
private func writeJpegImageUsingImageIO(from sourceURL: URL, to targetURL: URL) throws {
    guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil) else {
        throw photoLibraryError("Failed to create image source", code: 1)
    }
    try writeJpegImageSourceUsingImageIO(source, to: targetURL)
}

@available(iOS 14.0, *)
private func writeJpegImageSourceUsingImageIO(_ source: CGImageSource, to targetURL: URL) throws {
    guard CGImageSourceGetCount(source) > 0 else {
        throw photoLibraryError("Selected photo did not contain an image", code: 2)
    }

    guard let destination = CGImageDestinationCreateWithURL(
        targetURL as CFURL,
        UTType.jpeg.identifier as CFString,
        1,
        nil
    ) else {
        throw photoLibraryError("Failed to create JPEG destination", code: 3)
    }

    guard let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw photoLibraryError("Failed to decode selected photo", code: 4)
    }

    let sourceProperties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    let destinationProperties: [CFString: Any] = [
        kCGImageDestinationLossyCompressionQuality: 0.92,
    ].merging(sourceProperties ?? [:]) { compressionQuality, _ in
        compressionQuality
    }

    CGImageDestinationAddImage(destination, image, destinationProperties as CFDictionary)

    guard CGImageDestinationFinalize(destination) else {
        throw photoLibraryError("Failed to encode selected photo as JPEG", code: 5)
    }
}

@_cdecl("init_plugin_photo_library")
func initPlugin() -> Plugin {
    if #available(iOS 14.0, *) {
        return PhotoLibraryPlugin()
    }

    return UnavailablePhotoLibraryPlugin()
}
