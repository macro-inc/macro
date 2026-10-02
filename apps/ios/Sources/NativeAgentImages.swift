import Foundation
import CryptoKit

struct NativeAgentImage: Equatable, Sendable, Identifiable {
    let id: String
    var label: String
    var url: URL?
    var data: Data?
    private final class CachedImage { let value: NativeAgentImage; init(_ value: NativeAgentImage) { self.value = value } }
    private static let decoded: NSCache<NSString, CachedImage> = {
        let cache = NSCache<NSString, CachedImage>(); cache.countLimit = 24; cache.totalCostLimit = 64_000_000; return cache
    }()

    static func content(_ value: WorkspaceJSON) -> [NativeAgentImage] {
        if !value.array.isEmpty { return value.array.flatMap(content) }
        if value["type"].string == "content" { return content(value["content"]) }
        guard value["type"].string == "image" else { return [] }
        let label = value["name"].string ?? "Agent image"
        if let encoded = value["data"].string, encoded.utf8.count <= 28_000_000,
           ["image/png", "image/jpeg", "image/webp", "image/gif"].contains(value["mimeType"].string ?? "") {
            let key = encoded as NSString
            if var cached = decoded.object(forKey: key)?.value { cached.label = label; return [cached] }
            if let data = Data(base64Encoded: encoded), !data.isEmpty {
                let image = Self(id: Data(SHA256.hash(data: data)).base64EncodedString(), label: label, data: data)
                decoded.setObject(CachedImage(image), forKey: key, cost: data.count + encoded.utf8.count)
                return [image]
            }
        }
        if let string = value["uri"].string ?? value["url"].string, let url = URL(string: string), url.scheme == "https" {
            return [.init(id: string, label: label, url: url)]
        }
        return []
    }
}

struct NativeAgentMarkdownBlock: Identifiable, Equatable {
    var id: Int
    var text: String = ""
    var image: NativeAgentImage?
    private static let imagePattern = try? NSRegularExpression(pattern: #"!\[([^\]\n]*)\]\((https://[^\s)]+)(?:\s+\"[^\"]*\")?\)"#)

    static func parse(_ text: String) -> [NativeAgentMarkdownBlock] {
        guard text.contains("!["), let pattern = imagePattern else { return [.init(id: 0, text: text)] }
        let input = text as NSString
        let code = MentionCodec.codeRanges(in: text)
        var cursor = 0
        var blocks: [NativeAgentMarkdownBlock] = []
        for match in pattern.matches(in: text, range: NSRange(location: 0, length: input.length)) {
            guard !code.contains(where: { NSIntersectionRange($0, match.range).length > 0 }), let url = URL(string: input.substring(with: match.range(at: 2))), url.scheme == "https" else { continue }
            if match.range.location > cursor { blocks.append(.init(id: cursor, text: input.substring(with: NSRange(location: cursor, length: match.range.location - cursor)))) }
            blocks.append(.init(id: match.range.location, image: .init(id: url.absoluteString, label: input.substring(with: match.range(at: 1)), url: url)))
            cursor = NSMaxRange(match.range)
        }
        if cursor < input.length { blocks.append(.init(id: cursor, text: input.substring(from: cursor))) }
        return blocks
    }
}
