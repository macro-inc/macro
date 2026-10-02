import Foundation

/// Portable MIME alternatives for the same canonical mention wire used by the native editor.
/// Only parsed tokens become links; every ordinary character is escaped as email text.
enum EmailRichBody {
    struct Prepared: Equatable {
        let text: String
        let html: String
        var encodedHTML: String {
            Data(html.utf8).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        }
    }
    static func prepare(_ wire: String, webURL: URL) -> Prepared {
        let source = wire as NSString
        var plain = "", html = "", location = 0
        for span in MentionCodec.tokens(in: wire) {
            let before = source.substring(with: NSRange(location: location, length: span.range.location - location))
            plain += before; html += escape(before)
            let token = span.token
            plain += token.displayText
            let label = escape(token.displayText)
            if let url = link(token, webURL: webURL) {
                var attributes = ""
                if let block = payload(token.wire)?["blockName"] as? String {
                    attributes = " data-document-mention=\"true\" data-document-id=\"\(escape(token.entityID))\" data-document-name=\"\(escape(token.title))\" data-block-name=\"\(escape(block))\""
                }
                html += "<a href=\"\(escape(url.absoluteString))\"\(attributes)>\(label)</a>"
            } else { html += label }
            location = NSMaxRange(span.range)
        }
        let rest = source.substring(from: location)
        plain += rest; html += escape(rest)
        return Prepared(text: plain, html: "<div>" + html.replacingOccurrences(of: "\n", with: "<br>") + "</div>")
    }
    private static func link(_ token: MentionToken, webURL: URL) -> URL? {
        if token.kind == .link {
            guard let url = URL(string: token.entityID), ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") else { return nil }
            return url
        }
        if token.kind == .agent, safeComponent(token.entityID), webURL.scheme == "https" {
            return webURL.appendingPathComponent("agents").appendingPathComponent(token.entityID)
        }
        guard let block = payload(token.wire)?["blockName"] as? String,
              safeComponent(block), safeComponent(token.entityID), webURL.scheme == "https" else { return nil }
        return webURL.appendingPathComponent(block).appendingPathComponent(token.entityID)
    }
    private static func safeComponent(_ value: String) -> Bool {
        !value.isEmpty && value != "." && value != ".." && value.rangeOfCharacter(from: CharacterSet(charactersIn: "/?#\\")) == nil
    }
    private static func payload(_ wire: String) -> [String: Any]? {
        guard let first = wire.firstIndex(of: ">"), let last = wire.range(of: "</m-", options: .backwards)?.lowerBound,
              let data = String(wire[wire.index(after: first)..<last]).data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
    private static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;").replacingOccurrences(of: "'", with: "&#39;")
    }
}
