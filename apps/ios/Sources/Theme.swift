import SwiftUI
import ImageIO

enum MacroTheme {
    static let accent = Color(red: 0.37, green: 0.64, blue: 0.87)
    static let background = Color(uiColor: surface)
    static let surface = UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(white: 0.06, alpha: 1) : .systemBackground
    }
    static let green = Color(red: 0.46, green: 0.98, blue: 0.51)
}

struct MacroMark: Shape {
    func path(in rect: CGRect) -> Path {
        let contours: [[CGPoint]] = [
            [.init(x: 0, y: 10.014), .init(x: 0, y: 16.815), .init(x: 0.225, y: 17.328), .init(x: 2.967, y: 19.972), .init(x: 4.969, y: 19.172), .init(x: 4.969, y: 12.073), .init(x: 1.999, y: 9.214)],
            [.init(x: 4.078, y: 4.8), .init(x: 4.078, y: 10.586), .init(x: 5.438, y: 11.895), .init(x: 5.438, y: 13.208), .init(x: 12.481, y: 20), .init(x: 14.483, y: 19.2), .init(x: 14.482, y: 12.1), .init(x: 6.078, y: 4)],
            [.init(x: 13.594, y: 4.8), .init(x: 13.594, y: 10.586), .init(x: 14.954, y: 11.897), .init(x: 14.941, y: 13.197), .init(x: 22, y: 20), .init(x: 24, y: 19.2), .init(x: 24, y: 12.42), .init(x: 23.775, y: 11.887), .init(x: 15.595, y: 4)]
        ]
        return Path { path in
            for contour in contours {
                path.addLines(contour.map { CGPoint(x: $0.x / 24 * rect.width, y: $0.y / 24 * rect.height) })
                path.closeSubpath()
            }
        }
    }
}

struct AvatarView: View {
    let name: String
    var size: CGFloat = 46
    var isChannel = false
    var photoURL: URL? = nil
    @State private var loadedImage: UIImage?
    @State private var loadedURL: URL?

    var body: some View {
        ZStack {
            Circle().fill(MacroTheme.accent.opacity(0.09))
            if isChannel {
                Image(systemName: "number").font(.system(size: size * 0.43, weight: .medium))
            } else {
                Text(String(name.prefix(1)).uppercased()).font(.system(size: size * 0.4, weight: .semibold, design: .rounded))
            }
        }
        .foregroundStyle(MacroTheme.accent)
        .frame(width: size, height: size)
        .overlay {
            if let photoURL {
                if let bitmap = NativeAvatarCache.shared.cached(photoURL) ?? (loadedURL == photoURL ? loadedImage : nil) {
                    Image(uiImage: bitmap).resizable().scaledToFill().frame(width: size, height: size).clipShape(Circle())
                }
            }
        }
        .task(id: photoURL) {
            guard let photoURL else { loadedImage = nil; loadedURL = nil; return }
            let image = await NativeAvatarCache.shared.load(photoURL)
            guard !Task.isCancelled else { return }
            loadedURL = photoURL; loadedImage = image
        }
        .transaction { transaction in transaction.animation = nil; transaction.disablesAnimations = true }
        .accessibilityHidden(true)
    }
}

/// Reused timeline cells obtain already decoded photos synchronously, without a
/// transient initials frame. A shared request survives one cell's cancellation.
@MainActor
final class NativeAvatarCache {
    static let shared = NativeAvatarCache()
    private let images = NSCache<NSURL, UIImage>()
    private var requests: [URL: Task<UIImage?, Never>] = [:]
    private init() { images.countLimit = 300; images.totalCostLimit = 24_000_000 }
    func cached(_ url: URL) -> UIImage? { images.object(forKey: url as NSURL) }
    func load(_ url: URL) async -> UIImage? {
        if let image = cached(url) { return image }
        if let pending = requests[url] { return await pending.value }
        let task = Task.detached(priority: .utility) { () -> UIImage? in
            do {
                let request = URLRequest(url: url, timeoutInterval: 20)
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), data.count <= 12_000_000,
                      let source = CGImageSourceCreateWithData(data as CFData, nil),
                      let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 192, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else { return nil }
                return UIImage(cgImage: thumbnail)
            } catch { return nil }
        }
        requests[url] = task
        let image = await task.value
        requests[url] = nil
        if let image { images.setObject(image, forKey: url as NSURL, cost: Int(image.size.width * image.size.height * 4)) }
        return image
    }
}
