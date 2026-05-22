import ImageIO
import PhotosUI
import Tauri
import UIKit
import UniformTypeIdentifiers

private let maxPhotoLibrarySelectionCount = 10

// The Rust upload handler (src-tauri/src/staged_upload.rs) finds the staged
// file by source/token, so these values MUST stay in sync with
// StagedUploadSource::PhotoLibrary:
//   - cache directory: Library/Caches/<bundleIdentifier>
//   - subdirectory name: ios-photo-library-staging
//   - token prefix:      photo-stage-

class UnavailablePhotoLibraryPlugin: Plugin {
    @objc public func pickPhotoLibraryImages(_ invoke: Invoke) {
        invoke.reject("Photo library picker requires iOS 14 or newer")
    }
}

@available(iOS 14.0, *)
class PhotoLibraryPlugin: Plugin {
    private let stagingDirectoryName = "ios-photo-library-staging"
    private var pickerDelegate: PhotoLibraryPickerDelegate?

    @objc public func pickPhotoLibraryImages(_ invoke: Invoke) {
        DispatchQueue.main.async {
            guard self.pickerDelegate == nil else {
                invoke.reject("Photo library picker is already open")
                return
            }

            guard let rootViewController = self.manager.viewController else {
                invoke.reject("No view controller available to present photo library")
                return
            }

            guard let viewController = topmostPresentableViewController(from: rootViewController) else {
                invoke.reject("Photo library picker cannot be presented right now")
                return
            }

            var configuration = PHPickerConfiguration(photoLibrary: .shared())
            configuration.filter = .images
            configuration.preferredAssetRepresentationMode = .current
            configuration.selectionLimit = maxPhotoLibrarySelectionCount

            let picker = PHPickerViewController(configuration: configuration)
            let delegate = PhotoLibraryPickerDelegate(
                plugin: self,
                invoke: invoke,
                onComplete: { [weak self] in
                    self?.pickerDelegate = nil
                }
            )
            self.pickerDelegate = delegate
            picker.delegate = delegate

            viewController.present(picker, animated: true)
        }
    }

    fileprivate func stagingDirectory() -> URL {
        appCacheDirectory()
            .appendingPathComponent(stagingDirectoryName, isDirectory: true)
    }

    fileprivate func stageImageFile(
        sourceURL: URL,
        typeIdentifier: String?,
        suggestedName: String?
    ) throws -> StagedPhotoLibraryImage {
        let sourceType = imageType(typeIdentifier: typeIdentifier, sourceURL: sourceURL)
        let shouldConvertToJpeg = isHeicOrHeif(type: sourceType, sourceURL: sourceURL)
        let token = "photo-stage-\(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())"
        let fileExtension = shouldConvertToJpeg
            ? "jpg"
            : preferredFilenameExtension(type: sourceType, sourceURL: sourceURL)
        let name = sanitizedImageFilename(suggestedName, fileExtension: fileExtension)
        let targetURL = stagingDirectory().appendingPathComponent("\(token)-\(name)")

        try FileManager.default.createDirectory(
            at: stagingDirectory(),
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

        return StagedPhotoLibraryImage(
            token: token,
            name: name,
            mimeType: shouldConvertToJpeg
                ? "image/jpeg"
                : mimeType(type: sourceType, sourceURL: targetURL),
            size: size?.uint64Value ?? 0,
            previewPath: targetURL.path
        )
    }

    private func appCacheDirectory() -> URL {
        let cacheDirectory = FileManager.default.urls(
            for: .cachesDirectory,
            in: .userDomainMask
        )[0]

        guard
            let bundleIdentifier = Bundle.main.bundleIdentifier,
            !bundleIdentifier.isEmpty
        else {
            return cacheDirectory
        }

        return cacheDirectory.appendingPathComponent(
            bundleIdentifier,
            isDirectory: true
        )
    }

    fileprivate func cleanupStalePhotoLibraryImages() {
        let directory = stagingDirectory()
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

private struct StagedPhotoLibraryImage: Encodable {
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
    private let onComplete: () -> Void

    init(plugin: PhotoLibraryPlugin, invoke: Invoke, onComplete: @escaping () -> Void) {
        self.plugin = plugin
        self.invoke = invoke
        self.onComplete = onComplete
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)

        guard !results.isEmpty else {
            invoke.resolve([StagedPhotoLibraryImage]())
            onComplete()
            return
        }

        guard let plugin = plugin else {
            invoke.reject("Photo library plugin was released")
            onComplete()
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            plugin.cleanupStalePhotoLibraryImages()

            let group = DispatchGroup()
            let lock = NSLock()
            var stagedImages = Array<StagedPhotoLibraryImage?>(
                repeating: nil,
                count: results.count
            )
            var firstError: String?

            for (index, result) in results.enumerated() {
                let provider = result.itemProvider
                guard let typeIdentifier = imageTypeIdentifier(from: provider) else {
                    continue
                }

                group.enter()
                provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, error in
                    defer { group.leave() }

                    if let error = error {
                        lock.lock()
                        firstError = firstError ?? error.localizedDescription
                        lock.unlock()
                        return
                    }

                    guard let url = url else {
                        lock.lock()
                        firstError = firstError ?? "Selected photo did not provide a file"
                        lock.unlock()
                        return
                    }

                    do {
                        let staged = try plugin.stageImageFile(
                            sourceURL: url,
                            typeIdentifier: typeIdentifier,
                            suggestedName: provider.suggestedName
                        )
                        lock.lock()
                        stagedImages[index] = staged
                        lock.unlock()
                    } catch {
                        lock.lock()
                        firstError = firstError ?? error.localizedDescription
                        lock.unlock()
                    }
                }
            }

            group.notify(queue: .main) {
                let orderedStagedImages = stagedImages.compactMap { $0 }
                if !orderedStagedImages.isEmpty {
                    self.invoke.resolve(orderedStagedImages)
                } else if let firstError = firstError {
                    self.invoke.reject("Failed to stage photo library image: \(firstError)")
                } else {
                    self.invoke.resolve([StagedPhotoLibraryImage]())
                }
                self.onComplete()
            }
        }
    }
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
private func imageTypeIdentifier(from provider: NSItemProvider) -> String? {
    preferredTypeIdentifier(
        from: provider,
        preferredTypes: preferredImageTypes(),
        fallbackType: .image
    )
}

@available(iOS 14.0, *)
private func preferredImageTypes() -> [UTType] {
    ["jpg", "png", "heic", "heif", "webp", "gif"].compactMap {
        UTType(filenameExtension: $0)
    }
}

@available(iOS 14.0, *)
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
private func imageSourceType(from sourceURL: URL) -> UTType? {
    guard
        let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
        let typeIdentifier = CGImageSourceGetType(source)
    else {
        return nil
    }

    return UTType(typeIdentifier as String)
}

private func sanitizedImageFilename(_ suggestedName: String?, fileExtension: String) -> String {
    let fallback = "photo-library-image"
    let rawName = suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines)
    let basename = rawName?.isEmpty == false ? rawName! : fallback
    let filename = URL(fileURLWithPath: basename).lastPathComponent
    let nameWithoutExtension = URL(fileURLWithPath: filename)
        .deletingPathExtension()
        .lastPathComponent
    let normalizedName = nameWithoutExtension.isEmpty ? fallback : nameWithoutExtension
    let normalizedExtension = fileExtension.trimmingCharacters(in: .whitespacesAndNewlines)

    return "\(normalizedName).\(normalizedExtension.isEmpty ? "jpg" : normalizedExtension)"
}

@available(iOS 14.0, *)
private func preferredFilenameExtension(type: UTType?, sourceURL: URL) -> String {
    if let fileExtension = type?.preferredFilenameExtension, !fileExtension.isEmpty {
        return fileExtension
    }
    if !sourceURL.pathExtension.isEmpty {
        return sourceURL.pathExtension
    }
    return "jpg"
}

@available(iOS 14.0, *)
private func mimeType(type: UTType?, sourceURL: URL) -> String {
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
    default:
        return "application/octet-stream"
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
