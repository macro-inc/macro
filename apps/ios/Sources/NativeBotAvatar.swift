import SwiftUI

/// Supplied bot photos win; built-in agents retain their actual brand glyph before a photo resolves.
struct NativeBotAvatar: View {
    let id: String
    let name: String
    var photoURL: URL?
    var size: CGFloat = 32

    private var glyph: String? {
        switch id.replacingOccurrences(of: "bot|", with: "").lowercased() {
        case "00000000-0000-0000-0000-00000000c5c5": "cursor"
        case "00000000-0000-0000-0000-00000000c0de": "openai"
        case "00000000-0000-0000-0000-00000000c1a0": "claude"
        case "00000000-0000-0000-0000-00000000a1a1", "00000000-0000-0000-0000-00000000a9e7": "macro-logo"
        default: nil
        }
    }
    var body: some View {
        ZStack {
            Circle().fill(MacroTheme.background)
            if let glyph {
                MacroIcon(name: glyph, size: size * 0.8).foregroundStyle(glyph == "macro-logo" ? MacroTheme.accent : .primary)
            } else {
                AvatarView(name: name, size: size)
            }
            if let photoURL {
                AsyncImage(url: photoURL) { image in image.resizable().scaledToFill() } placeholder: { Color.clear }
                    .frame(width: size, height: size).clipShape(Circle())
            }
        }.frame(width: size, height: size).accessibilityHidden(true)
    }
}

/// Same elbow connector and clipped quote typography as QuoteReplyPreview.tsx.
struct NativeReplyQuote: View {
    let sender: String
    let text: String
    @ScaledMetric(relativeTo: .body) private var remPoints: CGFloat = 17
    private var rem: CGFloat { remPoints / 16 }
    var body: some View {
        HStack(spacing: 4 * rem) {
            ReplyElbow().stroke(Color.primary.opacity(0.16), lineWidth: 2)
                .frame(width: 20 * rem, height: 21.333 * rem).padding(.leading, 4 * rem)
            Text(sender).font(.system(size: 12 * rem, weight: .semibold)).foregroundStyle(.secondary).fixedSize()
            Text(MentionCodec.displayText(in: text)).font(.system(size: 12 * rem)).italic().foregroundStyle(.secondary).lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
        }.padding(.vertical, 4 * rem)
    }
}

private struct ReplyElbow: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.move(to: CGPoint(x: rect.width, y: rect.height / 2))
            path.addLine(to: CGPoint(x: rect.width * 0.4, y: rect.height / 2))
            path.addQuadCurve(to: CGPoint(x: 0, y: rect.height * 0.75), control: CGPoint(x: 0, y: rect.height / 2))
            path.addLine(to: CGPoint(x: 0, y: rect.height))
        }
    }
}
