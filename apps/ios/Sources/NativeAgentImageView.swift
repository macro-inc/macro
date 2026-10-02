import SwiftUI
import ImageIO

struct NativeAgentImageView: View {
    let image: NativeAgentImage
    @State private var bitmap: UIImage?
    @State private var finishedDecoding = false
    var body: some View {
        Group {
            if image.data != nil {
                if let bitmap { Image(uiImage: bitmap).resizable().scaledToFit() }
                else if finishedDecoding { Label("Image could not be displayed", systemImage: "photo").font(.caption).foregroundStyle(.secondary).padding(20) }
                else { ProgressView().frame(maxWidth: .infinity).frame(minHeight: 150) }
            } else if let url = image.url {
                AsyncImage(url: url) { state in
                    if let loaded = state.image { loaded.resizable().scaledToFit() }
                    else if state.error != nil { Link(destination: url) { Label(image.label.isEmpty ? "Open image" : image.label, systemImage: "photo") }.font(.caption).padding(20) }
                    else { ProgressView().frame(maxWidth: .infinity).frame(minHeight: 150) }
                }
            }
        }.frame(maxWidth: .infinity).accessibilityLabel(image.label.isEmpty ? "Agent image" : image.label)
            .task(id: image.id) {
                guard let data = image.data else { return }
                let loaded = await Task.detached(priority: .utility) {
                    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                          let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 2000, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) else { return Optional<UIImage>.none }
                    return UIImage(cgImage: thumbnail)
                }.value
                if !Task.isCancelled { bitmap = loaded; finishedDecoding = true }
            }
    }
}
