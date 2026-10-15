import Foundation

/// Mobile Soup pins cached channel name matches and up to three other name matches.
/// Service payloads win by ID so a featured row keeps its exact message/search target.
enum WorkspaceSearchProjection {
    struct Result { var items: [WorkspaceItem]; var featuredCount: Int }
    static func project(query: String, cached: [WorkspaceItem], service: [WorkspaceItem]) -> Result {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        guard !needle.isEmpty else { return Result(items: service, featuredCount: 0) }
        var unique = Set<String>()
        let local = cached.filter { unique.insert($0.id).inserted }.compactMap { item -> (WorkspaceItem, Double)? in
            let title = item.title.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            let fuzzy: Double
            if title == needle { fuzzy = 1 }
            else if title.hasPrefix(needle) { fuzzy = 0.9 }
            else if title.contains(needle) { fuzzy = 0.75 }
            else {
                var chars = needle.makeIterator(); var next = chars.next()
                for char in title where next != nil { if char == next { next = chars.next() } }
                guard next == nil else { return nil }
                fuzzy = Double(needle.count) / Double(max(title.count, 1)) * 0.4
            }
            let age = max(0, Date().timeIntervalSince(item.date)) / 86400
            return (item, fuzzy * 0.7 + 0.3 / (1 + age / 7))
        }.sorted { $0.1 == $1.1 ? $0.0.title < $1.0.title : $0.1 > $1.1 }.map(\.0)
        let channels = local.filter { $0.kind == .channel && $0.entityType == "channel" }
        let others = local.filter { $0.kind != .channel }.prefix(3)
        let featured = channels + others
        var byID: [String: WorkspaceItem] = [:]
        for item in service + featured where byID[item.id] == nil { byID[item.id] = item }
        let ids = Set(featured.map(\.id))
        var seen = Set<String>()
        let ordered = featured.compactMap { byID[$0.id] } + service.filter { !ids.contains($0.id) && seen.insert($0.id).inserted }
        return Result(items: ordered, featuredCount: featured.count)
    }
}
