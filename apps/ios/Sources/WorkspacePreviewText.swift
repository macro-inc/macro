import Foundation

/// A readable inbox preview with token styling metadata; it never changes the stored message.
enum WorkspacePreviewText {
    struct Fragment: Equatable, Sendable {
        var text: String
        var isMention = false
    }
    static func fragments(_ wire: String, prefix: String = "") -> [Fragment] {
        let spans = MentionCodec.tokens(in: wire)
        guard !spans.isEmpty else { return [Fragment(text: prefix + WorkspaceItem.previewText(wire))] }
        // Protect labels while the surrounding Markdown is reduced to its visible text.
        // Private-use delimiters are selected outside the source to avoid collisions.
        var marker = "\u{F0000}"
        while wire.contains(marker) { marker += "\u{F0000}" }
        let close = "\u{F0001}"
        let protected = NSMutableString(string: wire)
        for (index, span) in spans.enumerated().reversed() {
            protected.replaceCharacters(in: span.range, with: marker + String(index) + close)
        }
        let plain = WorkspaceItem.previewText(protected as String)
        var fragments = prefix.isEmpty ? [] : [Fragment(text: prefix)]
        var remaining = plain[...]
        while let start = remaining.range(of: marker), let end = remaining[start.upperBound...].range(of: close),
              let index = Int(remaining[start.upperBound..<end.lowerBound]), spans.indices.contains(index) {
            if start.lowerBound > remaining.startIndex { fragments.append(Fragment(text: String(remaining[..<start.lowerBound]))) }
            let token = spans[index].token
            fragments.append(Fragment(text: token.displayText, isMention: token.kind != .link))
            remaining = remaining[end.upperBound...]
        }
        if !remaining.isEmpty { fragments.append(Fragment(text: String(remaining))) }
        return fragments
    }
}
