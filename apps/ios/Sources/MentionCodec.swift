import Foundation

enum MentionKind: String, Codable, Sendable {
    case user, channel, group, document, email, folder, task, agent, chat, company, date, call, calendar, link
}

struct MentionCandidate: Equatable, Identifiable, Sendable {
    let kind: MentionKind
    let id: String
    let title: String
    var subtitle: String = ""
    var blockName: String? = nil
    var updatedAt: String? = nil
    var photoURL: URL? = nil
    var isDirectMessage = false

    var displayText: String { token.displayText }
    var identity: String { kind.rawValue + ":" + id }

    var token: MentionToken {
        let tag: String
        let payload: [String: Any]
        let entityType: String
        switch kind {
        case .user:
            tag = "user-mention"; entityType = id.hasPrefix("bot|") ? "bot" : "user"
            payload = ["userId": id, "email": subtitle.isEmpty ? id.replacingOccurrences(of: "macro|", with: "") : subtitle, "displayName": title]
        case .group:
            tag = "group-mention"; entityType = "group"; payload = ["groupAlias": id]
        case .agent:
            tag = "agent-session-mention"; entityType = "agent_session"; payload = ["id": id, "label": title]
        case .date:
            tag = "date-mention"; entityType = ""; payload = ["date": id, "displayFormat": title]
        case .link:
            tag = "link"; entityType = ""; payload = ["url": id, "text": title, "title": ""]
        default:
            tag = "document-mention"
            let block = blockName ?? Self.defaultBlock(kind)
            entityType = MentionCodec.entityType(block: block)
            payload = ["documentId": id, "documentName": title, "blockName": block, "blockParams": [:], "collapsed": false]
        }
        let encoded = (try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data("{}".utf8)
        let json = String(decoding: encoded, as: UTF8.self).replacingOccurrences(of: "<", with: "\\u003c").replacingOccurrences(of: ">", with: "\\u003e")
        let wire = "<m-\(tag)>\(json)</m-\(tag)>"
        return MentionToken(kind: kind, entityID: id, title: title, entityType: entityType, wire: wire)
    }
    private static func defaultBlock(_ kind: MentionKind) -> String {
        switch kind {
        case .channel: "channel"
        case .email: "email"
        case .folder: "project"
        case .task: "task"
        case .chat: "chat"
        case .company: "company"
        case .call: "call"
        case .calendar: "calendar_event"
        default: "md"
        }
    }

    /// Local candidates are available immediately while the shared search fills other entities.
    static func search(_ query: String, channel: Channel, channels: [Channel], names: [String: String], currentUserID: String, includeGroups: Bool = true) -> [MentionCandidate] {
        let localIDs = Set(channel.participants.map(\.userID))
        let allIDs = Set(channels.flatMap { $0.participants.map(\.userID) }).union(names.keys).union(localIDs)
        var choices = allIDs.filter { $0 != currentUserID && ($0.hasPrefix("macro|") || $0.hasPrefix("bot|")) }.map { id in
            let email = id.replacingOccurrences(of: "macro|", with: "")
            let title = names[id].flatMap { $0 == id || $0.isEmpty ? nil : $0 } ?? (id.hasPrefix("bot|") ? "Macro Agent" : email.components(separatedBy: "@").first ?? email)
            return MentionCandidate(kind: .user, id: id, title: title, subtitle: id.hasPrefix("bot|") ? "Agent" : email)
        }
        choices += channels.map { item in
            let title = item.name.flatMap { $0.isEmpty ? nil : $0 }
                ?? item.participants.filter { $0.userID != currentUserID }.map { names[$0.userID] ?? $0.userID.replacingOccurrences(of: "macro|", with: "") }.joined(separator: ", ")
            return MentionCandidate(kind: .channel, id: item.id, title: title.isEmpty ? "Conversation" : title,
                                    subtitle: item.channelType == "direct_message" ? "Direct message" : "Channel", updatedAt: item.latestMessage?.createdAt, isDirectMessage: item.channelType == "direct_message")
        }
        if includeGroups && !channel.id.isEmpty { choices.append(MentionCandidate(kind: .group, id: "here", title: "here", subtitle: "Notify people in this channel")) }
        return ranked(choices, query: query, preferredUsers: localIDs)
    }

    /// Mobile web pins two people, then blends fuzzy matches with recent activity.
    /// Fold once per item and compare scores during sorting, keeping keystrokes cheap.
    static func ranked(_ candidates: [MentionCandidate], query: String, preferredUsers: Set<String> = []) -> [MentionCandidate] {
        let query = query.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current).trimmingCharacters(in: .whitespaces)
        let now = Date()
        var seen = Set<String>()
        let scored = candidates.compactMap { item -> (item: MentionCandidate, score: Double, userScore: Double)? in
            guard seen.insert(item.identity).inserted else { return nil }
            let title = item.title.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            guard item.kind != .group || query.isEmpty || title.hasPrefix(query) else { return nil }
            let haystack = (item.title + " " + item.subtitle).folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            let fuzzy: Double
            if query.isEmpty { fuzzy = 0 }
            else if title.hasPrefix(query) { fuzzy = 1 }
            else if haystack.contains(query) { fuzzy = 0.8 }
            else {
                var remaining = query.makeIterator(); var sought = remaining.next(); var matched = 0
                for character in haystack where sought != nil { if character == sought { matched += 1; sought = remaining.next() } }
                guard sought == nil else { return nil }
                fuzzy = 0.3 * Double(matched) / Double(max(haystack.count, 1))
            }
            let age = item.updatedAt.map { max(0, now.timeIntervalSince(MessageDate.parse($0))) / 86400 }
            let freshness = age.map { 1 / (1 + $0 / 7) } ?? 0
            let kindBoost = item.kind == .user ? (query.isEmpty ? 0.2 : 0.4) : item.kind == .group ? 0.1 : 0
            let score = query.isEmpty ? freshness * 0.9 + kindBoost : fuzzy * 0.5 + freshness * 0.4 + 0.1 / Double(max(title.count, 1)) + kindBoost
            return (item, score * (item.isDirectMessage ? (query.isEmpty ? 1.2 : 1.4) : 1), score + (preferredUsers.contains(item.id) ? 2 : 0) + (item.id.hasPrefix("bot|") ? 1 : 0))
        }
        let pinned = scored.filter { $0.item.kind == .user }.sorted { $0.userScore == $1.userScore ? $0.item.title < $1.item.title : $0.userScore > $1.userScore }.prefix(2)
        let pinnedIDs = Set(pinned.map { $0.item.identity })
        let rest = scored.filter { !pinnedIDs.contains($0.item.identity) }.sorted { $0.score == $1.score ? $0.item.title < $1.item.title : $0.score > $1.score }
        return (pinned.map(\.item) + rest.map(\.item)).prefix(150).map { $0 }
    }
}

struct MentionToken: Equatable, Sendable {
    let kind: MentionKind
    let entityID: String
    let title: String
    let entityType: String
    let wire: String
    var displayText: String {
        switch kind {
        case .user, .group: "@" + title
        case .channel: "#" + title
        default: title
        }
    }
}

struct MentionSpan: Equatable, Sendable {
    let range: NSRange
    let token: MentionToken
}

enum MentionCodec {
    private static let tags = try! NSRegularExpression(pattern: #"<m-((?:user|document|group|date|agent-session)-mention|link)>(.*?)</m-\1>"#, options: [.dotMatchesLineSeparators])
    private static let fences = try! NSRegularExpression(pattern: #"(?m)^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n|$)"#)

    static func entityType(block: String) -> String {
        switch block {
        case "channel", "chat", "project", "call", "calendar_event", "agent_session": block
        case "agent": "agent_session"
        case "email", "email_thread", "thread": "thread"
        case "company", "crm_company": "crm_company"
        case "contact", "crm_contact": "crm_contact"
        default: "document"
        }
    }
    static func tokens(in content: String) -> [MentionSpan] {
        let text = content as NSString
        let matches = tags.matches(in: content, range: NSRange(location: 0, length: text.length))
        let excluded = codeRanges(in: content, mentionRanges: matches.map(\.range))
        return matches.compactMap { match in
            guard !excluded.contains(where: { NSIntersectionRange($0, match.range).length > 0 }) else { return nil }
            let type = text.substring(with: match.range(at: 1))
            let wire = text.substring(with: match.range)
            guard let json = text.substring(with: match.range(at: 2)).data(using: .utf8),
                  let payload = (try? JSONSerialization.jsonObject(with: json)) as? [String: Any] else {
                return type == "link" ? MentionSpan(range: match.range, token: .init(kind: .link, entityID: "", title: "Unknown link", entityType: "", wire: wire)) : nil
            }
            let token: MentionToken
            if type == "user-mention" {
                guard let id = payload["userId"] as? String, !id.isEmpty else { return nil }
                let email = payload["email"] as? String ?? id.replacingOccurrences(of: "macro|", with: "")
                let display = (payload["displayName"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                    ?? email.components(separatedBy: "@").first ?? email
                token = MentionToken(kind: .user, entityID: id, title: display, entityType: id.hasPrefix("bot|") ? "bot" : "user", wire: wire)
            } else if type == "document-mention" {
                guard let id = payload["documentId"] as? String, !id.isEmpty, let name = payload["documentName"] as? String else { return nil }
                let block = payload["blockName"] as? String ?? "unknown"
                let kind: MentionKind
                switch block {
                case "channel": kind = .channel
                case "email", "email_thread", "thread": kind = .email
                case "project": kind = .folder
                case "task": kind = .task
                case "chat": kind = .chat
                case "agent", "agent_session": kind = .agent
                case "company", "crm_company", "contact", "crm_contact": kind = .company
                case "call": kind = .call
                case "calendar_event": kind = .calendar
                default: kind = .document
                }
                token = MentionToken(kind: kind, entityID: id, title: name, entityType: entityType(block: block), wire: wire)
            } else if type == "agent-session-mention" {
                guard let id = payload["id"] as? String, !id.isEmpty else { return nil }
                token = .init(kind: .agent, entityID: id, title: payload["label"] as? String ?? "Agent session", entityType: "agent_session", wire: wire)
            } else if type == "date-mention" {
                guard let date = payload["date"] as? String, let title = payload["displayFormat"] as? String else { return nil }
                token = .init(kind: .date, entityID: date, title: title, entityType: "", wire: wire)
            } else if type == "link" {
                let url = payload["url"] as? String ?? ""
                let label = (payload["text"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (url.isEmpty ? "Unknown link" : url)
                token = .init(kind: .link, entityID: url, title: label, entityType: "", wire: wire)
            } else {
                guard let alias = payload["groupAlias"] as? String, alias == "here" else { return nil }
                token = MentionToken(kind: .group, entityID: alias, title: alias, entityType: "group", wire: wire)
            }
            return MentionSpan(range: match.range, token: token)
        }
    }
    static func mentions(in content: String) -> [MessageMention] {
        var seen = Set<String>()
        return tokens(in: content).compactMap { span in
            let token = span.token
            guard !token.entityType.isEmpty, seen.insert(token.entityType + ":" + token.entityID).inserted else { return nil }
            return MessageMention(entityID: token.entityID, entityType: token.entityType)
        }
    }
    static func displayText(in content: String) -> String { render(content, markdown: false) }
    static func markdownForDisplay(in content: String) -> String { render(content, markdown: true) }
    private static func render(_ content: String, markdown: Bool) -> String {
        let quoted = markdown ? ReplyTargetContent.markdownForDisplay(in: content) : ReplyTargetContent.displayText(in: content)
        let content = ChannelAgentCardContent.displayText(in: quoted)
        let result = NSMutableString(string: content)
        for span in tokens(in: content).reversed() {
            let token = span.token
            var replacement = token.displayText
            if markdown, token.kind == .link, let url = URL(string: token.entityID), ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                let label = replacement.replacingOccurrences(of: #"([\\\[\]*_`])"#, with: #"\\$1"#, options: .regularExpression)
                let target = url.absoluteString.replacingOccurrences(of: "(", with: "%28").replacingOccurrences(of: ")", with: "%29")
                replacement = "[\(label)](\(target))"
            }
            result.replaceCharacters(in: span.range, with: replacement)
        }
        return result as String
    }

    /// Code examples are literal text, so they must never create notification recipients.
    static func codeRanges(in content: String, mentionRanges: [NSRange] = []) -> [NSRange] {
        let text = content as NSString
        var ranges: [NSRange] = []
        var open: (start: Int, marker: unichar, count: Int)?
        for match in fences.matches(in: content, range: NSRange(location: 0, length: text.length)) {
            let marker = text.character(at: match.range(at: 1).location)
            if let active = open {
                let trailing = text.substring(with: match.range(at: 2)).trimmingCharacters(in: .whitespaces)
                if active.marker == marker, match.range(at: 1).length >= active.count, trailing.isEmpty {
                    ranges.append(NSRange(location: active.start, length: NSMaxRange(match.range) - active.start))
                    open = nil
                }
            } else { open = (match.range.location, marker, match.range(at: 1).length) }
        }
        if let open { ranges.append(NSRange(location: open.start, length: text.length - open.start)) }

        var cursor = 0
        while cursor < text.length {
            if let fenced = ranges.first(where: { NSLocationInRange(cursor, $0) }) { cursor = NSMaxRange(fenced); continue }
            if let mention = mentionRanges.first(where: { NSLocationInRange(cursor, $0) }) { cursor = NSMaxRange(mention); continue }
            guard text.character(at: cursor) == 96 else { cursor += 1; continue }
            var start = cursor
            while start > 0 && text.character(at: start - 1) == 92 { start -= 1 }
            if (cursor - start) % 2 == 1 { cursor += 1; continue }
            var end = cursor
            while end < text.length && text.character(at: end) == 96 { end += 1 }
            let run = end - cursor
            var search = end
            var closing: Int?
            while search < text.length {
                if ranges.contains(where: { NSLocationInRange(search, $0) }) { break }
                guard text.character(at: search) == 96 else { search += 1; continue }
                var after = search
                while after < text.length && text.character(at: after) == 96 { after += 1 }
                if after - search == run { closing = after; break }
                search = after
            }
            if let closing {
                ranges.append(NSRange(location: cursor, length: closing - cursor))
                cursor = closing
            } else { cursor = end }
        }
        return ranges
    }
}
