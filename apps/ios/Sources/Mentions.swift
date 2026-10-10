import UIKit

struct MentionQuery: Equatable {
    let query: String
    /// UTF-16 range, including the @ trigger, matching UITextView.selectedRange.
    let range: NSRange
}

extension NSAttributedString.Key {
    static let macroMention = NSAttributedString.Key("com.macro.native.mention")
}

@MainActor
enum MentionComposer {
    private static let trigger = try! NSRegularExpression(pattern: #"(?:^|[\s(\[{])@([\p{L}\p{N}\p{M} ._'\-]{0,60})$"#)

    static var typingAttributes: [NSAttributedString.Key: Any] {
        let metrics = UIFontMetrics(forTextStyle: .body)
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = metrics.scaledValue(for: 25.5)
        paragraph.maximumLineHeight = paragraph.minimumLineHeight
        return [.font: metrics.scaledFont(for: .systemFont(ofSize: 15.9375)), .foregroundColor: UIColor.label, .paragraphStyle: paragraph]
    }

    static func attributedText(from wire: String) -> NSAttributedString {
        let result = NSMutableAttributedString(string: wire, attributes: typingAttributes)
        for span in MentionCodec.tokens(in: wire).reversed() {
            result.replaceCharacters(in: span.range, with: attributedToken(span.token))
        }
        return result
    }

    static func wireContent(from attributed: NSAttributedString) -> String {
        let text = attributed.string as NSString
        var result = ""
        attributed.enumerateAttribute(.macroMention, in: NSRange(location: 0, length: attributed.length)) { value, range, _ in
            let visible = text.substring(with: range)
            if let wire = storedWire(from: value), let token = MentionCodec.tokens(in: wire).first?.token,
               token.displayText == visible {
                result += wire
            } else { result += visible }
        }
        return result
    }

    static func activeQuery(in attributed: NSAttributedString, selection: NSRange) -> MentionQuery? {
        guard selection.length == 0, selection.location > 0, selection.location <= attributed.length else { return nil }
        if attributed.attribute(.macroMention, at: selection.location - 1, effectiveRange: nil) != nil { return nil }
        let prefix = (attributed.string as NSString).substring(to: selection.location)
        guard let match = trigger.firstMatch(in: prefix, range: NSRange(location: 0, length: (prefix as NSString).length)) else { return nil }
        let queryRange = match.range(at: 1)
        let range = NSRange(location: queryRange.location - 1, length: queryRange.length + 1)
        var overlapsMention = false
        attributed.enumerateAttribute(.macroMention, in: range) { value, _, stop in
            if value != nil { overlapsMention = true; stop.pointee = true }
        }
        guard !overlapsMention else { return nil }
        guard !MentionCodec.codeRanges(in: prefix).contains(where: { NSIntersectionRange($0, range).length > 0 }) else { return nil }
        return MentionQuery(query: (prefix as NSString).substring(with: queryRange), range: range)
    }

    static func insert(_ candidate: MentionCandidate, replacing query: MentionQuery, in textView: UITextView) {
        guard query.range.location >= 0, NSMaxRange(query.range) <= textView.attributedText.length else { return }
        let replacement = NSMutableAttributedString(attributedString: attributedToken(candidate.token))
        replacement.append(NSAttributedString(string: " ", attributes: typingAttributes))
        textView.textStorage.replaceCharacters(in: query.range, with: replacement)
        textView.selectedRange = NSRange(location: query.range.location + replacement.length, length: 0)
        textView.typingAttributes = typingAttributes
        textView.becomeFirstResponder()
        textView.delegate?.textViewDidChange?(textView)
    }

    /// A selected token deletes as one unit. Editing inside it turns it into ordinary text.
    /// Return this from UITextViewDelegate.shouldChangeTextIn, before any normal edit handling.
    static func shouldChange(_ textView: UITextView, range: NSRange, replacement: String) -> Bool {
        guard range.location >= 0, NSMaxRange(range) <= textView.textStorage.length else { return false }
        var affected: [NSRange] = []
        textView.textStorage.enumerateAttribute(.macroMention, in: NSRange(location: 0, length: textView.textStorage.length)) { value, tokenRange, _ in
            guard value != nil else { return }
            let interiorInsertion = range.length == 0 && range.location > tokenRange.location && range.location < NSMaxRange(tokenRange)
            if interiorInsertion || NSIntersectionRange(range, tokenRange).length > 0 { affected.append(tokenRange) }
        }
        textView.typingAttributes = typingAttributes
        guard !affected.isEmpty else { return true }
        if replacement.isEmpty, range.length > 0 {
            let deletion = affected.reduce(range) { NSUnionRange($0, $1) }
            textView.textStorage.replaceCharacters(in: deletion, with: "")
            textView.selectedRange = NSRange(location: deletion.location, length: 0)
            textView.typingAttributes = typingAttributes
            textView.delegate?.textViewDidChange?(textView)
            return false
        }
        for tokenRange in affected {
            textView.textStorage.setAttributes(typingAttributes, range: tokenRange)
        }
        return true
    }

    /// Defends against pasted rich text and UIKit inheriting the preceding token's attributes.
    static func normalize(_ textView: UITextView) {
        var invalid: [NSRange] = []
        let text = textView.textStorage.string as NSString
        textView.textStorage.enumerateAttribute(.macroMention, in: NSRange(location: 0, length: textView.textStorage.length)) { value, range, _ in
            guard let value else { return }
            guard let wire = storedWire(from: value), let token = MentionCodec.tokens(in: wire).first?.token,
                  text.substring(with: range) == token.displayText else { invalid.append(range); return }
        }
        for range in invalid { textView.textStorage.setAttributes(typingAttributes, range: range) }
        textView.typingAttributes = typingAttributes
    }

    private static func attributedToken(_ token: MentionToken) -> NSAttributedString {
        var attributes = typingAttributes
        // Distinct instances prevent adjacent mentions of the same person from
        // coalescing into one attributed range and losing their wire representation.
        attributes[.macroMention] = ["wire": token.wire, "instance": UUID().uuidString]
        attributes[.foregroundColor] = UIColor.systemBlue
        attributes[.backgroundColor] = UIColor.systemBlue.withAlphaComponent(0.10)
        let font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 15.9375))
        if let descriptor = font.fontDescriptor.withSymbolicTraits(.traitBold) {
            attributes[.font] = UIFont(descriptor: descriptor, size: 0)
        }
        return NSAttributedString(string: token.displayText, attributes: attributes)
    }

    private static func storedWire(from value: Any?) -> String? {
        (value as? [String: String])?["wire"] ?? value as? String
    }
}

/// Mobile Tauri uses one blended list: compact rows, inline detail, and entity icons.
/// It intentionally has no desktop category bins and never steals composer focus.
@MainActor
final class MentionPickerView: UIView, UITableViewDataSource, UITableViewDelegate {
    private static let avatarCache = NSCache<NSString, UIImage>()
    var onSelect: ((MentionCandidate) -> Void)?
    var onLoadMore: (() -> Void)?
    private let glass = UIVisualEffectView()
    private let table = UITableView(frame: .zero, style: .plain)
    private let empty = UILabel()
    private var candidates: [MentionCandidate] = []
    private var query = ""
    private var hasMore = false
    private var isLoading = false
    private var requestedMore = false
    private var rowSize: CGFloat { max(36, UIFontMetrics(forTextStyle: .subheadline).scaledValue(for: 36)) }

    override init(frame: CGRect) {
        super.init(frame: frame)
        if #available(iOS 26, *) { glass.effect = UIGlassEffect(style: .regular) }
        else { glass.effect = UIBlurEffect(style: .systemMaterial) }
        layer.cornerRadius = 12; layer.borderWidth = 0.5
        layer.borderColor = UIColor.separator.withAlphaComponent(0.5).cgColor
        clipsToBounds = true
        accessibilityIdentifier = "mention-picker"
        table.backgroundColor = .clear; table.separatorStyle = .none
        table.rowHeight = rowSize; table.sectionHeaderHeight = 0; table.sectionFooterHeight = 0
        table.contentInset = .zero; table.sectionHeaderTopPadding = 0
        table.keyboardDismissMode = .none; table.dataSource = self; table.delegate = self
        table.register(UITableViewCell.self, forCellReuseIdentifier: "mention")
        table.accessibilityIdentifier = "mention-results"
        empty.font = UIFontMetrics(forTextStyle: .subheadline).scaledFont(for: .systemFont(ofSize: 12.75))
        empty.textColor = .secondaryLabel; empty.textAlignment = .left
        table.backgroundView = empty
        [glass, table].forEach { addSubview($0); $0.translatesAutoresizingMaskIntoConstraints = false }
        glass.isUserInteractionEnabled = false
        let bottom = table.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -6)
        bottom.priority = UILayoutPriority(999)
        NSLayoutConstraint.activate([
            glass.leadingAnchor.constraint(equalTo: leadingAnchor), glass.trailingAnchor.constraint(equalTo: trailingAnchor),
            glass.topAnchor.constraint(equalTo: topAnchor), glass.bottomAnchor.constraint(equalTo: bottomAnchor),
            table.topAnchor.constraint(equalTo: topAnchor, constant: 8),
            table.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6), table.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6), bottom
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override var intrinsicContentSize: CGSize {
        let visibleRows = min(max(1, candidates.count), max(1, Int((270 - 14) / rowSize)))
        return CGSize(width: UIView.noIntrinsicMetric, height: CGFloat(visibleRows) * rowSize + 14)
    }
    func fittingHeight(maximum: CGFloat) -> CGFloat {
        let rows = max(0, Int((maximum - 14) / rowSize))
        return rows == 0 ? 0 : min(intrinsicContentSize.height, CGFloat(rows) * rowSize + 14)
    }
    func update(candidates: [MentionCandidate], query: String, hasMore: Bool = false, isLoading: Bool = false) {
        let changedQuery = self.query != query
        self.query = query; self.hasMore = hasMore; self.isLoading = isLoading
        if self.candidates.count != candidates.count || changedQuery { requestedMore = false }
        self.candidates = MentionCandidate.ranked(candidates, query: query)
        empty.text = isLoading ? "  Searching…" : "  No results"
        empty.isHidden = !self.candidates.isEmpty
        table.rowHeight = rowSize; table.reloadData()
        if !self.candidates.isEmpty { table.selectRow(at: IndexPath(row: 0, section: 0), animated: false, scrollPosition: .none) }
        if changedQuery { table.setContentOffset(.zero, animated: false) }
        invalidateIntrinsicContentSize()
    }
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { candidates.count }
    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let candidate = candidates[indexPath.row]
        let cell = tableView.dequeueReusableCell(withIdentifier: "mention", for: indexPath)
        var content = cell.defaultContentConfiguration()
        let label = NSMutableAttributedString(string: candidate.kind == .group ? "@" + candidate.title : candidate.title,
            attributes: [.font: UIFontMetrics(forTextStyle: .subheadline).scaledFont(for: .systemFont(ofSize: 12.75, weight: .medium)), .foregroundColor: UIColor.label])
        if candidate.kind == .user && !candidate.id.hasPrefix("bot|"), !candidate.subtitle.isEmpty, candidate.subtitle != candidate.title {
            label.append(NSAttributedString(string: "  " + candidate.subtitle, attributes: [.foregroundColor: UIColor.secondaryLabel]))
        }
        content.attributedText = label
        content.textProperties.numberOfLines = 1; content.textProperties.lineBreakMode = .byTruncatingTail
        content.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 5, leading: 6, bottom: 5, trailing: 6)
        content.imageToTextPadding = 8.5
        content.image = candidate.kind == .user && !candidate.id.hasPrefix("bot|") ? avatar(for: candidate) : UIImage(named: "macro-" + icon(candidate))?.withRenderingMode(.alwaysTemplate)
        content.imageProperties.tintColor = candidate.kind == .document ? .systemPurple : .secondaryLabel
        content.imageProperties.maximumSize = CGSize(width: candidate.kind == .user ? 20 : 16, height: candidate.kind == .user ? 20 : 16)
        cell.contentConfiguration = content; cell.backgroundColor = .clear
        let selected = UIView(); selected.backgroundColor = UIColor.label.withAlphaComponent(0.05); selected.layer.cornerRadius = 6
        cell.selectedBackgroundView = selected
        if candidate.id.hasPrefix("bot|") {
            let badge = UILabel(); badge.text = " Agent "; badge.font = .systemFont(ofSize: 10, weight: .medium)
            badge.textColor = .secondaryLabel; badge.backgroundColor = UIColor.label.withAlphaComponent(0.06); badge.layer.cornerRadius = 4; badge.clipsToBounds = true; badge.sizeToFit()
            cell.accessoryView = badge
        } else { cell.accessoryView = nil }
        cell.accessibilityIdentifier = "mention-option-\(candidate.id)"
        cell.accessibilityLabel = "\(candidate.title), \(candidate.subtitle)"
        cell.accessibilityHint = "Insert mention"
        return cell
    }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        guard candidates.indices.contains(indexPath.row) else { return }
        tableView.deselectRow(at: indexPath, animated: false)
        onSelect?(candidates[indexPath.row])
    }
    func tableView(_ tableView: UITableView, willDisplay cell: UITableViewCell, forRowAt indexPath: IndexPath) {
        guard hasMore, !isLoading, !requestedMore, indexPath.row >= candidates.count - 3 else { return }
        requestedMore = true; onLoadMore?()
    }
    private func icon(_ candidate: MentionCandidate) -> String {
        switch candidate.kind {
        case .user, .agent, .chat: "sparkle"
        case .group: "users"
        case .channel: candidate.isDirectMessage ? "chat-circle" : "hash-straight"
        case .email: "envelope"
        case .folder: "folder"
        case .task: "list-checks"
        case .company: "building"
        case .date: "clock"
        case .call: "phone-call"
        case .calendar: "calendar"
        case .link: "link"
        case .document: candidate.blockName == "spreadsheet" ? "table" : "file"
        }
    }
    private func avatar(for candidate: MentionCandidate) -> UIImage {
        let key = (candidate.id + ":" + candidate.title) as NSString
        if let cached = Self.avatarCache.object(forKey: key) { return cached }
        let initials = candidate.title.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
        let image = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).image { _ in
            UIColor.secondaryLabel.withAlphaComponent(0.15).setFill(); UIBezierPath(ovalIn: CGRect(x: 0, y: 0, width: 20, height: 20)).fill()
            let attributes: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 8, weight: .medium), .foregroundColor: UIColor.secondaryLabel]
            let label = initials as NSString; let size = label.size(withAttributes: attributes)
            label.draw(at: CGPoint(x: (20 - size.width) / 2, y: (20 - size.height) / 2), withAttributes: attributes)
        }
        Self.avatarCache.countLimit = 150; Self.avatarCache.setObject(image, forKey: key); return image
    }
}
