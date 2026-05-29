import UIKit
import Tauri

private struct StagePasteboardImagePayload: Decodable {
    let stagingDirectoryPath: String
    let tokenPrefix: String
}

class PasteboardPlugin: Plugin {
    @objc public func stagePasteboardImage(_ invoke: Invoke) throws {
        let payload = try invoke.parseArgs(StagePasteboardImagePayload.self)
        let stagingDirectory = URL(
            fileURLWithPath: payload.stagingDirectoryPath,
            isDirectory: true
        )

        DispatchQueue.main.async {
            guard let image = UIPasteboard.general.image else {
                invoke.resolve([
                    "token": NSNull(),
                    "name": NSNull(),
                    "mimeType": NSNull(),
                    "size": NSNull(),
                    "previewPath": NSNull(),
                ])
                return
            }

            DispatchQueue.global(qos: .userInitiated).async {
                self.cleanupStalePasteboardImages(in: stagingDirectory)

                let encoded = encodedData(from: image)
                guard let data = encoded.data else {
                    invoke.reject("Failed to encode pasteboard image")
                    return
                }

                let token = payload.tokenPrefix
                    + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
                let name = "pasted-image.\(encoded.fileExtension)"
                let fileURL = stagingDirectory.appendingPathComponent("\(token)-\(name)")

                do {
                    try FileManager.default.createDirectory(
                        at: stagingDirectory,
                        withIntermediateDirectories: true
                    )
                    try data.write(to: fileURL, options: [.atomic])
                    let size = try FileManager.default.attributesOfItem(
                        atPath: fileURL.path
                    )[.size] as? NSNumber

                    invoke.resolve([
                        "token": token,
                        "name": name,
                        "mimeType": encoded.mimeType,
                        "size": size?.uint64Value ?? UInt64(data.count),
                        "previewPath": fileURL.path,
                    ])
                } catch {
                    invoke.reject("Failed to stage pasteboard image: \(error.localizedDescription)")
                }
            }
        }
    }

    private func cleanupStalePasteboardImages(in directory: URL) {
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

private struct EncodedImageData {
    let data: Data?
    let mimeType: String
    let fileExtension: String
}

private let maxImagePixelDimension: CGFloat = 4096

private func encodedData(from image: UIImage) -> EncodedImageData {
    let normalized = normalizedImage(image)
    if imageHasAlpha(image), let data = normalized.pngData() {
        return EncodedImageData(
            data: data,
            mimeType: "image/png",
            fileExtension: "png"
        )
    }

    return EncodedImageData(
        data: normalized.jpegData(compressionQuality: 0.92),
        mimeType: "image/jpeg",
        fileExtension: "jpg"
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

private func normalizedImage(_ image: UIImage) -> UIImage {
    let widthPx = image.size.width * image.scale
    let heightPx = image.size.height * image.scale
    let longestPx = max(widthPx, heightPx)
    let needsDownscale = longestPx > maxImagePixelDimension

    if !needsDownscale && image.imageOrientation == .up {
        return image
    }

    let format = UIGraphicsImageRendererFormat()
    let targetSize: CGSize
    if needsDownscale {
        let ratio = maxImagePixelDimension / longestPx
        format.scale = 1
        targetSize = CGSize(width: widthPx * ratio, height: heightPx * ratio)
    } else {
        format.scale = image.scale
        targetSize = image.size
    }

    let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
    return renderer.image { _ in
        image.draw(in: CGRect(origin: .zero, size: targetSize))
    }
}

@_cdecl("init_plugin_pasteboard")
func initPlugin() -> Plugin {
    return PasteboardPlugin()
}
