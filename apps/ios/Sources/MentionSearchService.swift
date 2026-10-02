import Foundation

/// The same workspace/contact sources as web mentions, cached per signed-in session.
/// Local channel candidates can be shown immediately while this read-only search runs.
@MainActor
final class MentionSearchService {
    private let workspace: WorkspaceService
    private let session: NativeSession
    private var warmTask: Task<Void, Never>?
    private var recent: [MentionCandidate] = []
    private var people: [MentionCandidate] = []
    private var pages: [String: WorkspacePage] = [:]
    private var loadingPages: Set<String> = []

    init(session: NativeSession, workspace: WorkspaceService? = nil) {
        self.session = session; self.workspace = workspace ?? WorkspaceService(session: session)
    }

    func search(_ query: String) async -> [MentionCandidate] {
        await warm()
        let key = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if key.count >= 3, pages[key] == nil {
            do {
                let page = try await workspace.search(key)
                if pages.count >= 40, let old = pages.keys.first(where: { !$0.isEmpty }) { pages[old] = nil }
                pages[key] = page
            }
            catch { /* Keep cached candidates usable while offline or the search is cancelled. */ }
        }
        return results(key)
    }
    func hasMore(_ query: String) -> Bool { pages[pageKey(query)]?.nextCursor != nil }
    func loadMore(_ query: String) async -> [MentionCandidate] {
        let key = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let pageKey = pageKey(key)
        guard let cursor = pages[pageKey]?.nextCursor, loadingPages.insert(pageKey).inserted else { return results(key) }
        defer { loadingPages.remove(pageKey) }
        do {
            let page = key.count >= 3 ? try await workspace.search(key, cursor: cursor) : try await workspace.allEntityRecents(cursor: cursor)
            var existing = pages[pageKey]?.items ?? []; var ids = Set(existing.map { $0.entityType + ":" + $0.id })
            existing += page.items.filter { ids.insert($0.entityType + ":" + $0.id).inserted }
            pages[pageKey] = WorkspacePage(items: existing, nextCursor: page.nextCursor == cursor ? nil : page.nextCursor)
        } catch { }
        return results(key)
    }
    private func pageKey(_ query: String) -> String {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return query.count < 3 ? "" : query
    }
    private func results(_ query: String) -> [MentionCandidate] {
        MentionCandidate.ranked(people + recent + (pages[pageKey(query)]?.items.compactMap(Self.candidate) ?? []) + Self.dates(query), query: query)
    }
    private func warm() async {
        if let warmTask { await warmTask.value; return }
        let task = Task { [weak self] in
            guard let self else { return }
            async let recentPage = try? workspace.allEntityRecents()
            async let directory = contacts()
            let (page, contacts) = await (recentPage, directory)
            if let page { recent = page.items.compactMap(Self.candidate); pages[""] = page }
            people = contacts
        }
        warmTask = task
        await task.value
    }
    private func contacts() async -> [MentionCandidate] {
        if session.isDemo {
            return [MentionCandidate(kind: .user, id: "macro|jamie@macro.local", title: "Jamie Chen", subtitle: "jamie@macro.local"),
                    MentionCandidate(kind: .user, id: "macro|taylor@macro.local", title: "Taylor Lee", subtitle: "taylor@macro.local")]
        }
        struct Contacts: Decodable { let contacts: [String] }
        do {
            let request = URLRequest(url: session.environment.gatewayURL.appendingPathComponent("contacts/contacts"))
            let ids = try JSONDecoder().decode(Contacts.self, from: await session.authenticatedData(for: request)).contacts
            let profiles = MessagingAPI(baseURL: session.environment.gatewayURL, tokenProvider: { [session] in try await session.macroAPIToken() })
            let names = (try? await profiles.userNames(userIDs: ids)) ?? [:]
            return ids.filter { $0 != session.userID && ($0.hasPrefix("macro|") || $0.hasPrefix("bot|")) }.map { id in
                let email = id.replacingOccurrences(of: "macro|", with: "")
                return MentionCandidate(kind: .user, id: id, title: names[id].flatMap { $0 == id || $0.isEmpty ? nil : $0 } ?? (id.hasPrefix("bot|") ? "Macro Agent" : email.components(separatedBy: "@")[0]), subtitle: id.hasPrefix("bot|") ? "Agent" : email)
            }
        } catch { return [] }
    }

    static func candidate(_ item: WorkspaceItem) -> MentionCandidate? {
        let kind: MentionKind; let block: String; let id: String
        switch item.kind {
        case .document:
            kind = .document; id = item.id
            let subtype = item.payload.firstString("subType", "sub_type")
                ?? item.payload["subType"]["type"].string ?? item.payload["sub_type"]["type"].string
            block = ["snippet", "skill"].contains(subtype ?? "") ? subtype! : documentBlock(item.fileType)
        case .task: kind = .task; block = "task"; id = item.id
        case .folder: kind = .folder; block = "project"; id = item.id
        case .agent: kind = .agent; block = "agent"; id = item.id
        case .chat: kind = .chat; block = "chat"; id = item.id
        case .email: kind = .email; block = "email"; id = item.id
        case .channel:
            if item.entityType == "channel_message", item.channelID == nil { return nil }
            kind = .channel; block = "channel"; id = item.channelID ?? item.id
        case .call: kind = .call; block = "call"; id = item.id
        case .calendar: kind = .calendar; block = "calendar_event"; id = item.id
        case .other where ["crmCompany", "crm_company"].contains(item.entityType): kind = .company; block = "company"; id = item.id
        default: return nil
        }
        return MentionCandidate(kind: kind, id: id, title: item.title, subtitle: item.kind == .agent ? item.payload["bot"]["name"].string ?? "Agent session" : item.kind.rawValue.capitalized,
            blockName: block, updatedAt: item.updatedAt, photoURL: item.photoURL,
            isDirectMessage: item.payload["channel_type"].string == "direct_message" || item.payload["channelType"].string == "direct_message")
    }
    private static func documentBlock(_ type: String?) -> String {
        switch type?.lowercased() {
        case "task", "skill", "snippet", "canvas", "csv": type!.lowercased()
        case "pdf", "docx", "write": "pdf"
        case "spreadsheet", "xlsx", "xls": "spreadsheet"
        case "png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "image": "image"
        case "mp4", "webm", "mov", "video": "video"
        case "txt", "json", "yaml", "yml", "toml", "xml", "html", "css", "js", "jsx", "ts", "tsx", "rs", "py", "go", "swift", "c", "cpp", "h", "java", "sql", "sh", "code": "code"
        default: "md"
        }
    }
    static func dates(_ query: String, now: Date = Date(), calendar: Calendar = .current) -> [MentionCandidate] {
        let today = calendar.startOfDay(for: now)
        var choices: [(Date, String)] = [(today, "Today")]
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: today) { choices.append((tomorrow, "Tomorrow")) }
        if let nextWeek = calendar.date(byAdding: .day, value: 7, to: today) { choices.append((nextWeek, "Next week")) }
        let cleaned = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.count >= 3, let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue),
           let match = detector.firstMatch(in: cleaned, range: NSRange(cleaned.startIndex..., in: cleaned)), let date = match.date {
            choices.insert((date, cleaned), at: 0)
        }
        var seen = Set<String>()
        return choices.compactMap { date, title in
            let id = MessageDate.string(date)
            guard seen.insert(id).inserted else { return nil }
            return MentionCandidate(kind: .date, id: id, title: title, subtitle: date.formatted(date: .abbreviated, time: .omitted))
        }
    }
}
