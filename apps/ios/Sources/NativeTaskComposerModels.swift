import Foundation

struct NativeTaskAssignee: Codable, Identifiable, Hashable {
    var id: String
    var name: String
}
struct NativeTaskTag: Codable, Identifiable, Hashable {
    var id: String
    var definitionID: String
    var name: String
    var scope: String
}
struct NativeTaskMedia: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var url: URL
    var isVideo: Bool
}
struct NativeTaskComposerDraft: Codable, Hashable {
    var title = ""
    var content = ""
    var status = "notStarted"
    var priority: Int? = nil
    var assignees: [NativeTaskAssignee] = []
    var dueDate: Date? = nil
    var tags: [NativeTaskTag] = []
    var media: [NativeTaskMedia] = []
    var isEmpty: Bool { title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && content.isEmpty && media.isEmpty }
    var markdown: String {
        ([content] + media.map { ($0.isVideo ? "[" : "![") + $0.name.replacingOccurrences(of: "]", with: "\\]") + "](\($0.url.absoluteString))" })
            .filter { !$0.isEmpty }.joined(separator: "\n\n")
    }
    var properties: [WorkspaceJSON] {
        func property(_ id: String, _ value: WorkspaceJSON) -> WorkspaceJSON { .object(["propertyId": .string(id), "value": value]) }
        let selectedStatus = WorkspaceTaskStatus(rawValue: status) ?? .notStarted
        var values = [property(WorkspaceProperty.statusID, .object(["type": .string("select_option"), "option_id": .string(selectedStatus.optionID)]))]
        if let priority, (1...4).contains(priority) {
            values.append(property("00000001-0000-0000-0000-000000000003", .object(["type": .string("select_option"), "option_id": .string("00000001-0000-0000-0003-00000000000\(priority)")])))
        }
        if !assignees.isEmpty {
            values.append(property(WorkspaceProperty.assigneesID, .object(["type": .string("multi_entity_reference"),
                "references": .array(Array(Set(assignees.map(\.id))).sorted().map { .object(["entity_id": .string($0), "entity_type": .string("USER")]) })])))
        }
        if let dueDate { values.append(property("00000001-0000-0000-0000-000000000004", .object(["type": .string("date"), "value": .string(MessageDate.string(dueDate))]))) }
        for (definition, tags) in Dictionary(grouping: tags, by: \.definitionID).sorted(by: { $0.key < $1.key }) {
            values.append(property(definition, .object(["type": .string("multi_select_option"), "option_ids": .array(Array(Set(tags.map(\.id))).sorted().map(WorkspaceJSON.string))])))
        }
        return values
    }
    static func initial(userID: String, displayName: String) -> NativeTaskComposerDraft {
        NativeTaskComposerDraft(assignees: userID.isEmpty ? [] : [NativeTaskAssignee(id: userID, name: displayName)])
    }
}

enum NativeTaskDraftCache {
    static func read(account: String) -> NativeTaskComposerDraft? {
        guard let data = try? Data(contentsOf: url(account)) else { return nil }
        return try? JSONDecoder().decode(NativeTaskComposerDraft.self, from: data)
    }
    static func write(_ draft: NativeTaskComposerDraft, account: String) {
        let location = url(account)
        do {
            try FileManager.default.createDirectory(at: location.deletingLastPathComponent(), withIntermediateDirectories: true)
            var folder = location.deletingLastPathComponent(); var resources = URLResourceValues(); resources.isExcludedFromBackup = true
            try folder.setResourceValues(resources)
            try JSONEncoder().encode(draft).write(to: location, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch { }
    }
    static func clear(account: String) { try? FileManager.default.removeItem(at: url(account)) }
    @MainActor static func account(_ session: NativeSession) -> String { session.environment.rawValue + ":" + (session.userID ?? "") }
    @MainActor static func clear(session: NativeSession) { clear(account: account(session)) }
    private static func url(_ account: String) -> URL {
        let key = Data(account.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("NativeTaskDrafts").appendingPathComponent(key + ".json")
    }
}
