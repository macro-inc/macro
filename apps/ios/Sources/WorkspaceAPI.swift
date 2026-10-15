import Foundation
import CryptoKit

@MainActor
final class WorkspaceService {
    typealias Request = @MainActor (URLRequest) async throws -> Data
    let userID: String
    let isDemo: Bool
    private let baseURL: URL
    private let requestData: Request
    private let uploadData: Request
    private var demoItems: [WorkspaceItem]
    private var demoSignalIDs: Set<String> = []
    private var demoNoiseIDs: Set<String> = []
    private var demoDoneIDs: Set<String> = []
    private var completedNotificationIDs: [String: [String]] = [:]

    convenience init(session: NativeSession) {
        self.init(baseURL: session.environment.gatewayURL, userID: session.userID ?? "", isDemo: session.isDemo) {
            try await session.authenticatedData(for: $0)
        }
    }

    init(baseURL: URL, userID: String, isDemo: Bool = false, upload: Request? = nil, request: @escaping Request) {
        self.baseURL = baseURL; self.userID = userID; self.isDemo = isDemo; requestData = request
        uploadData = upload ?? Self.uploadCreatedFile
        demoItems = WorkspaceFixtures.items(userID: userID)
        demoSignalIDs = Set(demoItems.filter { $0.isUnread && $0.kind != .call }.map(\.id))
        demoNoiseIDs = Set(demoItems.filter { $0.kind == .email && !$0.isUnread }.map(\.id))
    }

    func list(_ collection: WorkspaceCollection, cursor: String? = nil, filter: WorkspaceListFilter = .init()) async throws -> WorkspacePage {
        guard !filter.sortByName else { throw WorkspaceError.server("Sorting by name is not supported by this feed.") }
        guard collection != .recent || filter.isEmpty else { throw WorkspaceError.server("Recent keeps your files in the order you last edited them. Use another view to filter items.") }
        if isDemo { return filteredDemoPage(demoPage(collection, cursor: cursor), filter: filter) }
        let body = cursor == nil ? try await applying(filter, to: Self.filters(collection, userID: userID)) : Self.filters(collection, userID: userID)
        var next = cursor
        var seenCursors = Set(cursor.map { [$0] } ?? [])
        repeat {
            try Task.checkCancellation()
            let data = try await send(path: "dss/items/soup/ast", method: "POST", query: cursorQuery(next), body: body)
            var page = try await Self.decodePage(data)
            // Drive's Recent tab is document-only. The touched feed rejects
            // channel/email trees, so mirror Drive's location backstop and
            // continue through a page consisting entirely of those entities.
            if collection == .recent { page.items.removeAll { !Self.isRecentFile($0) } }
            guard collection == .recent, page.items.isEmpty, let cursor = page.nextCursor else { return page }
            guard seenCursors.insert(cursor).inserted else { throw WorkspaceError.invalidResponse }
            next = cursor
        } while true
    }

    /// The workspace-wide touched feed backs empty and short mention queries.
    /// Drive's Recent tab has separate document-only semantics.
    func allEntityRecents(cursor: String? = nil) async throws -> WorkspacePage {
        if isDemo { return WorkspacePage(items: cursor == nil ? demoItems : []) }
        var filters = Self.excludedFilters()
        // The touched query includes these targets by default and rejects
        // channel/email filter trees, even NIL-id exclusions.
        for key in ["df", "cf", "pf", "chanf", "ef"] { filters[key] = nil }
        filters["sort_method"] = .string("touched_by_me")
        return try await Self.decodePage(try await send(path: "dss/items/soup/ast", method: "POST",
            query: cursorQuery(cursor), body: .object(filters)))
    }

    func folder(_ id: String, cursor: String? = nil, filter: WorkspaceListFilter = .init()) async throws -> WorkspacePage {
        guard !filter.sortByName else { throw WorkspaceError.server("Sorting by name is not supported by this feed.") }
        if isDemo { return filteredDemoPage(WorkspacePage(items: cursor == nil ? demoItems.filter { $0.projectID == id } : []), filter: filter) }
        var filters = Self.excludedFilters()
        filters["df"] = Self.literal("pid", .string(id))
        filters["pf"] = Self.literal("pid", .string(id))
        filters["cf"] = Self.literal("pid", .string(id))
        filters["ef"] = Self.literal("ProjectId", .string(id))
        filters["emailView"] = .string("all")
        filters["expand"] = .bool(false)
        let body = cursor == nil ? try await applying(filter, to: .object(filters)) : .object(filters)
        return try await Self.decodePage(try await send(path: "dss/items/soup/ast", method: "POST",
            query: cursorQuery(cursor), body: body))
    }

    func channelCalls(channelID: String, cursor: String? = nil) async throws -> WorkspacePage {
        if isDemo { return WorkspacePage(items: cursor == nil ? demoItems.filter { $0.kind == .call && $0.channelID == channelID } : []) }
        var filters = Self.excludedFilters()
        filters["callf"] = Self.literal("ChannelId", .string(channelID))
        filters["expand"] = .bool(true); filters["limit"] = .number(100)
        filters["sort_method"] = .string("updated_at"); filters["sort_direction"] = .string("desc")
        return try await Self.decodePage(try await send(path: "dss/items/soup/ast", method: "POST",
            query: cursorQuery(cursor), body: .object(filters)))
    }

    func search(_ query: String, cursor: String? = nil, kind: WorkspaceKind? = nil) async throws -> WorkspacePage {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 3 else { throw WorkspaceError.searchTooShort }
        if isDemo { return WorkspacePage(items: cursor == nil ? demoItems.filter { (kind == nil || $0.kind == kind) && ($0.title + " " + $0.subtitle).localizedCaseInsensitiveContains(text) } : []) }
        let filters = try Self.searchFilters(kind)
        var next = cursor
        var seenCursors: Set<String> = Set(cursor.map { [$0] } ?? [])
        repeat {
            try Task.checkCancellation()
            var parameters = cursorQuery(next); parameters.append(URLQueryItem(name: "page_size", value: "50"))
            let data = try await send(path: "dss/search", method: "POST", query: parameters, body: .object([
                "query": .string(text), "match_type": .string("partial"), "search_on": .string("name_content"), "filters": filters,
            ]))
            var page = try await Self.decodePage(data, search: true)
            // Search exposes positive subtypes only. Keep Files exact and walk
            // past task-only pages rather than making later files unreachable.
            if kind == .document { page.items.removeAll { $0.kind == .task } }
            guard page.items.isEmpty, let cursor = page.nextCursor, kind == .document else { return page }
            guard seenCursors.insert(cursor).inserted else { throw WorkspaceError.invalidResponse }
            next = cursor
        } while true
    }

    private static func searchFilters(_ kind: WorkspaceKind?) throws -> WorkspaceJSON {
        guard let kind else { return .object(["agent_session_filters": .object(["include": .bool(true)])]) }
        let excluded = WorkspaceJSON.array([.string("00000000-0000-0000-0000-000000000000")])
        var filters = ["agent_session_filters": "ids", "calendar_event_filters": "calendar_event_ids",
            "call_filters": "channel_ids", "channel_filters": "channel_ids", "channel_thread_filters": "thread_ids",
            "chat_filters": "chat_ids", "crm_company_filters": "company_ids", "document_filters": "document_ids",
            "email_filters": "email_thread_ids", "foreign_entity_filters": "ids", "project_filters": "project_ids",
            "reminder_filters": "ids"].mapValues { WorkspaceJSON.object([$0: excluded]) }
        filters["call_filters"] = .object(["channel_ids": excluded, "call_ids": excluded])
        switch kind {
        case .document: filters["document_filters"] = .object([:])
        case .task: filters["document_filters"] = .object(["sub_types": .array([.string("task")])])
        case .agent: filters["agent_session_filters"] = .object(["include": .bool(true)])
        case .chat: filters["chat_filters"] = .object([:])
        case .channel:
            filters["channel_filters"] = .object([:]); filters["channel_thread_filters"] = .object([:])
        case .email: filters["email_filters"] = .object([:])
        case .folder: filters["project_filters"] = .object([:])
        case .calendar: filters["calendar_event_filters"] = .object([:])
        case .call: filters["call_filters"] = .object([:])
        case .reminder, .other: throw WorkspaceError.unsupportedAction
        }
        return .object(filters)
    }

    func notifications(cursor: String? = nil, states: [String] = ["unseen", "seen"]) async throws -> WorkspaceNotificationPage {
        if isDemo { return WorkspaceNotificationPage(items: [], nextCursor: nil) }
        var query = cursorQuery(cursor)
        query.append(URLQueryItem(name: "limit", value: "50"))
        query.append(URLQueryItem(name: "states", value: states.joined(separator: ",")))
        return try await decode(WorkspaceNotificationPage.self, path: "notification/user_notifications", query: query)
    }

    /// Resolve the notification behind an Inbox row before marking it seen.
    /// Event-item lookup covers both a channel and a thread's secondary ID.
    func channelTargetedItem(_ item: WorkspaceItem) async throws -> WorkspaceItem {
        guard !isDemo, NativeChannelRoute.needsNotificationTarget(item),
              let channelID = NativeChannelRoute.channelID(for: item) else { return item }
        let isThread = ["channel_message", "channel_thread"].contains(item.entityType)
        let eventID = isThread ? item.id : channelID
        var cursor: String?
        var seen = Set<String>()
        repeat {
            try Task.checkCancellation()
            var query = cursorQuery(cursor)
            query += [URLQueryItem(name: "limit", value: "50"), URLQueryItem(name: "states", value: isThread ? "unseen,seen" : "unseen")]
            let page = try await decode(WorkspaceNotificationPage.self,
                path: "notification/user_notifications/item/\(pathComponent(eventID))", query: query)
            if let target = NativeChannelRoute.target(for: item, notifications: page.items),
               // A Soup root fallback is not proof of a matching notification.
               page.items.contains(where: { notification in
                   let content = notification.metadata["content"]
                   return content.firstString("messageId", "message_id") == target.messageID
               }) {
                var result = item
                var payload = result.payload.object ?? [:]
                var value: [String: WorkspaceJSON] = ["messageId": .string(target.messageID)]
                if let thread = target.threadID { value["threadId"] = .string(thread) }
                payload["target"] = .object(value); result.payload = .object(payload)
                return result
            }
            guard let next = page.nextCursor else { return item }
            guard seen.insert(next).inserted else { throw WorkspaceError.invalidResponse }
            cursor = next
        } while true
    }

    /// Inbox Done resolves notifications; task completion has a separate explicit action.
    func setDone(item: WorkspaceItem, done: Bool = true) async throws {
        if isDemo {
            if done { demoDoneIDs.insert(item.id) }
            else { demoDoneIDs.remove(item.id) }
            return
        }
        if item.kind == .email {
            _ = try await graphql("mutation SetEmailThreadArchived($input: SetEmailThreadArchivedInput!) { setEmailThreadArchived(input: $input) { id inboxVisible } }",
                input: .object(["threadId": .string(item.id), "archived": .bool(done)]))
        } else if item.kind == .reminder {
            _ = try await send(path: "dss/reminders/\(pathComponent(item.id))", method: "PATCH", body: .object(["completed": .bool(done)]))
        } else if done {
            let result = try await updateNotifications(item: item, operation: "MARK_DONE")
            completedNotificationIDs[item.id] = result["updateNotificationsForEntity"].array.compactMap { $0["id"].string }
        } else if let ids = completedNotificationIDs[item.id], !ids.isEmpty {
            _ = try await graphql("mutation UpdateNotifications($input: UpdateNotificationsInput!) { updateNotifications(input: $input) { id } }",
                input: .object(["notificationIds": .array(ids.map(WorkspaceJSON.string)), "operation": .string("MARK_UNDONE")]))
        }
    }

    func markSeen(item: WorkspaceItem) async throws {
        if isDemo {
            if let index = demoItems.firstIndex(where: { $0.id == item.id }) { demoItems[index].isUnread = false }
            return
        }
        if item.kind == .email {
            _ = try await graphql("mutation MarkEmailThreadSeen($input: MarkEmailThreadSeenInput!) { markEmailThreadSeen(input: $input) { id isRead } }",
                input: .object(["threadId": .string(item.id)]))
        } else { _ = try await updateNotifications(item: item, operation: "MARK_SEEN") }
    }

    func setFavorite(item: WorkspaceItem, favorite: Bool) async throws {
        guard item.canFavorite else { throw WorkspaceError.unsupportedAction }
        if isDemo {
            if let index = demoItems.firstIndex(where: { $0.id == item.id }) { demoItems[index].isFavorite = favorite }
            return
        }
        if favorite {
            _ = try await send(path: "dss/favorites", method: "POST", body: .object([
                "entityType": .string(item.entityType), "entityId": .string(item.id)]))
        } else {
            _ = try await send(path: "dss/favorites/\(item.entityType)/\(pathComponent(item.id))", method: "DELETE")
        }
    }

    func setTaskCompleted(item: WorkspaceItem, completed: Bool) async throws {
        try await setTaskStatus(item: item, status: completed ? .completed : .notStarted)
    }

    func setTaskStatus(item: WorkspaceItem, status: WorkspaceTaskStatus) async throws {
        guard item.kind == .task else { throw WorkspaceError.unsupportedAction }
        if isDemo {
            if let index = demoItems.firstIndex(where: { $0.id == item.id }) { demoItems[index].status = status.title }
            return
        }
        _ = try await send(path: "dss/properties/entities/document/\(pathComponent(item.id))/\(WorkspaceProperty.statusID)", method: "PUT", body: .object([
            "value": .object(["type": .string("select_option"), "option_id": .string(status.optionID)])]))
    }

    func item(_ existing: WorkspaceItem) async throws -> WorkspaceItem {
        if isDemo { return demoItems.first { $0.id == existing.id } ?? existing }
        guard let target = Self.target(for: existing.entityType) else { throw WorkspaceError.unsupportedAction }
        var filters = Self.excludedFilters()
        filters[target.key] = Self.literal(target.idField, .string(existing.id))
        filters["limit"] = .number(1)
        let page = try await Self.decodePage(try await send(path: "dss/items/soup/ast", method: "POST", body: .object(filters)))
        guard let item = page.items.first(where: { $0.id == existing.id }) else { throw MessagingError.http(404) }
        return item
    }

    /// Resolve visible attachment metadata in batches without fetching each entity separately.
    func items(_ references: [WorkspaceItem]) async throws -> [WorkspaceItem] {
        var seen = Set<String>()
        let references = references.filter { Self.target(for: $0.entityType) != nil && seen.insert($0.entityType + ":" + $0.id).inserted }
        guard !references.isEmpty else { return [] }
        if isDemo { return references.map { reference in demoItems.first { $0.id == reference.id && $0.entityType == reference.entityType } ?? reference } }
        var resolved: [String: WorkspaceItem] = [:]
        for start in stride(from: 0, to: references.count, by: 100) {
            let batch = Array(references[start..<min(start + 100, references.count)])
            var filters = Self.excludedFilters()
            for target in Self.targets {
                let nodes = batch.filter { $0.entityType == target.type }.map { Self.literal(target.idField, .string($0.id)) }
                if !nodes.isEmpty { filters[target.key] = Self.combine("|", nodes) }
            }
            filters["limit"] = .number(100)
            var cursor: String?
            var cursors = Set<String>()
            repeat {
                try Task.checkCancellation()
                let page = try await Self.decodePage(try await send(path: "dss/items/soup/ast", method: "POST", query: cursorQuery(cursor), body: .object(filters)))
                for item in page.items { resolved[item.entityType + ":" + item.id] = item }
                guard let next = page.nextCursor else { break }
                guard cursors.insert(next).inserted else { throw WorkspaceError.invalidResponse }
                cursor = next
            } while true
        }
        return references.compactMap { resolved[$0.entityType + ":" + $0.id] }
    }

    func rename(item: WorkspaceItem, name: String) async throws {
        let name = try validatedName(name)
        guard item.canRename else { throw WorkspaceError.unsupportedAction }
        if isDemo {
            if let index = demoItems.firstIndex(where: { $0.id == item.id }) { demoItems[index].title = name }
            return
        }
        let path: String, method: String, key: String
        switch item.kind {
        case .document, .task: path = "dss/documents/\(pathComponent(item.id))"; method = "PATCH"; key = "documentName"
        case .folder: path = "dss/projects/\(pathComponent(item.id))"; method = "PATCH"; key = "name"
        case .agent: path = "agent-harness/agent-sessions/\(pathComponent(item.id))/name"; method = "PUT"; key = "name"
        case .chat: path = "cognition/chats/\(pathComponent(item.id))"; method = "PATCH"; key = "name"
        case .call: path = "dss/call/record/\(pathComponent(item.id))"; method = "PATCH"; key = "customName"
        default: throw WorkspaceError.unsupportedAction
        }
        _ = try await send(path: path, method: method, body: .object([key: .string(name)]))
    }

    func createFolder(name: String, parentID: String? = nil) async throws -> WorkspaceItem {
        let name = try validatedName(name)
        if isDemo {
            let item = WorkspaceItem(id: UUID().uuidString.lowercased(), kind: .folder, title: name,
                updatedAt: MessageDate.string(Date()), ownerID: userID, projectID: parentID, entityType: "project")
            demoItems.insert(item, at: 0); return item
        }
        var body: [String: WorkspaceJSON] = ["name": .string(name)]
        if let parentID { body["projectParentId"] = .string(parentID) }
        let raw: WorkspaceJSON = try await decode(WorkspaceJSON.self, path: "dss/projects", method: "POST", body: .object(body))
        return try WorkspaceItem.soup(.object(["tag": .string("project"), "data": raw["data"]]))
    }

    func createDocument(name: String, markdown: String = "", projectID: String? = nil, isTask: Bool = false, taskProperties: [WorkspaceJSON]? = nil) async throws -> WorkspaceItem {
        let name = try validatedName(name)
        if isDemo {
            let item = WorkspaceItem(id: UUID().uuidString.lowercased(), kind: isTask ? .task : .document, title: name,
                subtitle: markdown, updatedAt: MessageDate.string(Date()), ownerID: userID, fileType: "md", projectID: projectID,
                status: isTask ? WorkspaceTaskStatus.allCases.first(where: { status in taskProperties?.contains { $0["propertyId"].string == WorkspaceProperty.statusID && $0["value"]["option_id"].string == status.optionID } == true })?.title ?? "Not started" : nil, entityType: "document")
            demoItems.insert(item, at: 0); return item
        }
        var body: [String: WorkspaceJSON] = [isTask ? "taskName" : "documentName": .string(name), "markdown": .string(markdown)]
        if let projectID { body["projectId"] = .string(projectID) }
        if isTask {
            body["propertyValues"] = .array(taskProperties ?? [.object(["propertyId": .string(WorkspaceProperty.statusID),
                "value": .object(["type": .string("select_option"), "option_id": .string(WorkspaceProperty.notStartedID)])])])
        }
        let raw: WorkspaceJSON = try await decode(WorkspaceJSON.self,
            path: isTask ? "dss/documents/create_task" : "dss/documents/create_markdown", method: "POST", body: .object(body))
        guard let id = raw["documentId"].string else { throw WorkspaceError.invalidResponse }
        let metadata = raw["documentMetadata"]
        return WorkspaceItem(id: id, kind: isTask ? .task : .document, title: metadata["documentName"].string ?? name,
            subtitle: markdown, updatedAt: metadata.firstString("updatedAt", "createdAt") ?? MessageDate.string(Date()),
            ownerID: metadata["owner"].string ?? userID, fileType: "md", projectID: projectID,
            status: isTask ? WorkspaceTaskStatus.allCases.first(where: { status in taskProperties?.contains { $0["propertyId"].string == WorkspaceProperty.statusID && $0["value"]["option_id"].string == status.optionID } == true })?.title ?? "Not started" : nil, entityType: "document", payload: metadata)
    }

    /// Mirrors Launcher.runCreateAction: allocate the blank resource then open its editor.
    func createBlankResource(_ resource: WorkspaceBlankResource, projectID: String? = nil) async throws -> WorkspaceItem {
        if resource == .folder { return try await createFolder(name: resource.defaultName, parentID: projectID) }
        if isDemo {
            let item = WorkspaceItem(id: UUID().uuidString.lowercased(), kind: .document, title: resource.defaultName.isEmpty ? "Untitled" : resource.defaultName,
                updatedAt: MessageDate.string(Date()), ownerID: userID, fileType: resource.fileType, projectID: projectID, entityType: "document",
                payload: resource == .snippet ? .object(["subType": .object(["type": .string("snippet")])]) : .object([:]))
            demoItems.insert(item, at: 0); return item
        }
        let initial = resource.initialData
        let hash = Data(SHA256.hash(data: initial))
        var body: [String: WorkspaceJSON] = [resource == .snippet ? "snippetName" : "documentName": .string(resource.defaultName)]
        if let projectID { body["projectId"] = .string(projectID) }
        if resource == .document || resource == .snippet { body["markdown"] = .string("") }
        else {
            body["fileType"] = .string(resource.fileType)
            body["sha"] = .string(hash.map { String(format: "%02x", $0) }.joined())
        }
        let raw: WorkspaceJSON = try await decode(WorkspaceJSON.self,
            path: resource == .snippet ? "dss/documents/create_snippet" : resource == .document ? "dss/documents/create_markdown" : "dss/documents", method: "POST", body: .object(body))
        let payload = resource == .document || resource == .snippet ? raw : raw["data"]
        let metadata = payload["documentMetadata"]
        guard let id = payload["documentId"].string ?? metadata["documentId"].string else { throw WorkspaceError.invalidResponse }
        if resource == .canvas || resource == .code {
            do {
                guard let signed = payload["presignedUrl"].string, let url = URL(string: signed), url.scheme == "https" else { throw WorkspaceError.invalidResponse }
                var upload = URLRequest(url: url, timeoutInterval: 60)
                upload.httpMethod = "PUT"; upload.httpBody = initial
                upload.setValue(resource.contentType, forHTTPHeaderField: "Content-Type")
                upload.setValue(hash.base64EncodedString(), forHTTPHeaderField: "x-amz-checksum-sha256")
                _ = try await uploadData(upload)
            } catch {
                // Only remove the empty record allocated by this failed creation.
                _ = try? await send(path: "dss/documents/\(pathComponent(id))", method: "DELETE")
                throw error
            }
        } else if resource == .spreadsheet && payload["presignedUrl"].string != nil {
            _ = try? await send(path: "dss/documents/\(pathComponent(id))", method: "DELETE")
            throw WorkspaceError.server("The server does not support native spreadsheets yet.")
        }
        return WorkspaceItem(id: id, kind: .document,
            title: metadata["documentName"].string.flatMap { $0.isEmpty ? nil : $0 } ?? (resource.defaultName.isEmpty ? "Untitled" : resource.defaultName),
            updatedAt: metadata.firstString("updatedAt", "createdAt") ?? MessageDate.string(Date()), ownerID: metadata["owner"].string ?? userID,
            fileType: resource.fileType, projectID: projectID, entityType: "document", payload: resource == .snippet ? .object(["subType": .object(["type": .string("snippet")])]) : metadata)
    }

    private static func uploadCreatedFile(_ request: URLRequest) async throws -> Data {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw WorkspaceError.server("The new file could not finish uploading. Please try again.")
        }
        return data
    }

    func activeCalls() async throws -> [WorkspaceActiveCall] {
        if isDemo { return [] }
        struct Response: Decodable, Sendable { var calls: [WorkspaceActiveCall] }
        return try await decode(Response.self, path: "dss/call/active").calls
    }

    func callRecord(_ id: String) async throws -> WorkspaceCallRecord {
        if isDemo { return WorkspaceFixtures.callRecord(id: id, userID: userID) }
        return try await decode(WorkspaceCallRecord.self, path: "dss/call/record/\(pathComponent(id))")
    }

    private func updateNotifications(item: WorkspaceItem, operation: String) async throws -> WorkspaceJSON {
        let type = item.entityType.uppercased()
        return try await graphql("mutation UpdateNotificationsForEntity($input: UpdateNotificationsForEntityInput!) { updateNotificationsForEntity(input: $input) { id } }",
            input: .object(["entities": .array([.object(["entityId": .string(item.id), "entityType": .string(type)])]), "operation": .string(operation)]))
    }

    private func graphql(_ query: String, input: WorkspaceJSON) async throws -> WorkspaceJSON {
        let raw: WorkspaceJSON = try await decode(WorkspaceJSON.self, path: "dss/items/soup/graphql", method: "POST",
            body: .object(["query": .string(query), "variables": .object(["input": input])]))
        if let error = raw["errors"].array.first { throw WorkspaceError.server(error["message"].string ?? "The action could not be completed.") }
        guard raw["data"].object != nil else { throw WorkspaceError.invalidResponse }
        return raw["data"]
    }

    private func send(path: String, method: String = "GET", query: [URLQueryItem] = [], body: WorkspaceJSON? = nil) async throws -> Data {
        guard !isDemo else { throw WorkspaceError.invalidResponse }
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!); request.httpMethod = method; request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body { request.httpBody = try JSONEncoder().encode(body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return try await requestData(request)
    }

    private func decode<T: Decodable & Sendable>(_ type: T.Type, path: String, method: String = "GET", query: [URLQueryItem] = [], body: WorkspaceJSON? = nil) async throws -> T {
        let data = try await send(path: path, method: method, query: query, body: body)
        return try await Task.detached(priority: .userInitiated) { try JSONDecoder().decode(type, from: data) }.value
    }

    private nonisolated static func decodePage(_ data: Data, search: Bool = false) async throws -> WorkspacePage {
        try await Task.detached(priority: .userInitiated) {
            let raw = try JSONDecoder().decode(WorkspaceJSON.self, from: data)
            let key = search ? "results" : "items"
            guard case .array(let items) = raw[key] else { throw WorkspaceError.invalidResponse }
            return WorkspacePage(items: try items.map { try search ? WorkspaceItem.search($0) : WorkspaceItem.soup($0) }, nextCursor: raw["next_cursor"].string)
        }.value
    }

    private func cursorQuery(_ cursor: String?) -> [URLQueryItem] { cursor.map { [URLQueryItem(name: "cursor", value: $0)] } ?? [] }
    private func pathComponent(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))) ?? value }
    private func validatedName(_ value: String) throws -> String {
        let name = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw WorkspaceError.invalidName }
        return name
    }

    private static func literal(_ key: String, _ value: WorkspaceJSON) -> WorkspaceJSON { .object(["l": .object([key: value])]) }
    private static func and(_ nodes: WorkspaceJSON...) -> WorkspaceJSON { combine("&", nodes) }
    private static func or(_ nodes: WorkspaceJSON...) -> WorkspaceJSON { combine("|", nodes) }
    private static func combine(_ op: String, _ nodes: [WorkspaceJSON]) -> WorkspaceJSON {
        guard let first = nodes.first else { return .object(["l": .object([:])]) }
        guard nodes.count > 1 else { return first }
        let middle = nodes.count / 2
        return .object([op: .array([combine(op, Array(nodes[..<middle])), combine(op, Array(nodes[middle...]))])])
    }
    private static func not(_ node: WorkspaceJSON) -> WorkspaceJSON { .object(["!": node]) }

    private static let targets: [(type: String, key: String, idField: String)] = [
        ("document", "df", "id"), ("project", "pf", "pids"), ("chat", "cf", "cid"),
        ("channel", "chanf", "ChannelId"), ("channel_message", "cthf", "ThreadId"),
        ("email_thread", "ef", "ThreadId"), ("call", "callf", "CallId"),
        ("calendar_event", "calf", "id"), ("agent_session", "asf", "id"),
        ("reminder", "remf", "id"), ("foreign_entity", "fef", "id"), ("crm_company", "ccf", "id"),
    ]
    private static func target(for type: String) -> (type: String, key: String, idField: String)? { targets.first { $0.type == type } }

    private func applying(_ filter: WorkspaceListFilter, to base: WorkspaceJSON) async throws -> WorkspaceJSON {
        guard !filter.isEmpty else { return base }
        var body = base.object ?? [:]
        func intersect(_ key: String, _ condition: WorkspaceJSON) { body[key] = body[key].map { Self.and($0, condition) } ?? condition }
        if let kind = filter.kind {
            let allowed: [String]
            switch kind {
            case .document, .task: allowed = ["df"]
            case .folder: allowed = ["pf"]
            case .agent: allowed = ["asf"]
            case .chat: allowed = ["cf"]
            case .channel: allowed = ["chanf", "cthf"]
            case .email: allowed = ["ef"]
            case .call: allowed = ["callf"]
            case .calendar: allowed = ["calf"]
            case .reminder: allowed = ["remf"]
            case .other: allowed = ["fef", "ccf"]
            }
            for target in Self.targets where !allowed.contains(target.key) {
                body[target.key] = Self.literal(target.idField, .string("00000000-0000-0000-0000-000000000000"))
            }
            if kind == .task { intersect("df", Self.literal("dst", .string("task"))) }
            if kind == .document { intersect("df", Self.not(Self.literal("dst", .string("task")))) }
        }
        if filter.favoritesOnly {
            let favorites: WorkspaceJSON = try await decode(WorkspaceJSON.self, path: "dss/favorites")
            for target in Self.targets {
                let ids = favorites["favorites"].array.filter { $0["entityType"].string == target.type }.compactMap { $0["entityId"].string }
                let nodes = (ids.isEmpty ? ["00000000-0000-0000-0000-000000000000"] : ids).map { Self.literal(target.idField, .string($0)) }
                intersect(target.key, Self.combine("|", nodes))
            }
        }
        if filter.unreadOnly {
            for key in ["df", "pf", "cf", "calf", "fef"] { intersect(key, Self.literal("ns", .string("unseen"))) }
            for key in ["chanf", "cthf"] { intersect(key, Self.literal("NotificationState", .string("unseen"))) }
            intersect("ef", Self.literal("Read", .bool(false)))
            // These domains have no notification-state literal. Resolve their IDs
            // first, then intersect on the server rather than filtering a loaded page.
            let indirectTargets = Self.targets.filter {
                ["agent_session", "call", "reminder", "crm_company"].contains($0.type)
                    && !Self.excludesAll(body[$0.key], idField: $0.idField)
            }
            guard !indirectTargets.isEmpty else { return .object(body) }
            var notifications: [WorkspaceNotification] = []
            var next: String?
            var seenCursors: Set<String> = []
            repeat {
                let page = try await self.notifications(cursor: next, states: ["unseen"])
                notifications.append(contentsOf: page.items)
                next = page.nextCursor
                if let cursor = next, !seenCursors.insert(cursor).inserted { throw WorkspaceError.invalidResponse }
            } while next != nil
            for target in indirectTargets {
                let ids = Array(Set(notifications.filter { $0.entityType == target.type }.map(\.entityID)))
                let nodes = (ids.isEmpty ? ["00000000-0000-0000-0000-000000000000"] : ids).map { Self.literal(target.idField, .string($0)) }
                intersect(target.key, Self.combine("|", nodes))
            }
        }
        return .object(body)
    }

    private static func excludesAll(_ node: WorkspaceJSON?, idField: String) -> Bool {
        guard let node else { return false }
        if node["l"][idField].string == "00000000-0000-0000-0000-000000000000" { return true }
        if case .array(let nodes) = node["&"] { return nodes.contains { excludesAll($0, idField: idField) } }
        if case .array(let nodes) = node["|"] { return !nodes.isEmpty && nodes.allSatisfy { excludesAll($0, idField: idField) } }
        return false
    }

    private func filteredDemoPage(_ page: WorkspacePage, filter: WorkspaceListFilter) -> WorkspacePage {
        WorkspacePage(items: page.items.filter {
            (!filter.unreadOnly || $0.isUnread) && (!filter.favoritesOnly || $0.isFavorite) && (filter.kind == nil || $0.kind == filter.kind)
        }, nextCursor: page.nextCursor)
    }

    private static func excludedFilters() -> [String: WorkspaceJSON] {
        let nilID = WorkspaceJSON.string("00000000-0000-0000-0000-000000000000")
        var filters = ["df": "id", "cf": "cid", "pf": "pid", "ef": "ThreadId", "chanf": "ChannelId", "cthf": "ThreadId",
            "callf": "CallId", "calf": "id", "ccf": "id", "fef": "id", "asf": "id", "remf": "id"].mapValues { literal($0, nilID) }
        filters["limit"] = .number(50); filters["expand"] = .bool(true)
        filters["sort_method"] = .string("updated_at"); filters["sort_direction"] = .string("desc")
        return filters
    }

    static func filters(_ collection: WorkspaceCollection, userID: String) -> WorkspaceJSON {
        var filters = excludedFilters()
        let documents = and(not(literal("dst", .string("task"))), literal("iea", .bool(false)))
        switch collection {
        case .myFiles: filters["df"] = and(documents, literal("o", .string(userID)))
        case .sharedFiles: filters["df"] = and(documents, not(literal("o", .string(userID))))
        case .allFiles: filters["df"] = documents
        case .folders: filters["pf"] = not(literal("pid", .string("00000000-0000-0000-0000-000000000000")))
        case .tasks: filters["df"] = literal("dst", .string("task"))
        case .agents:
            filters["asf"] = literal("o", .string(userID)); filters["cf"] = literal("o", .string(userID))
        case .calls: filters["callf"] = nil
        case .recent:
            filters["df"] = and(documents, not(literal("dst", .string("snippet"))))
            // These two domains cannot be filtered by the touched query.
            // All other exclusions stay intact, just as in Drive's AST.
            filters["chanf"] = nil; filters["ef"] = nil
            filters["sort_method"] = .string("touched_by_me")
        case .signal, .noise:
            filters["sort_method"] = .string("notified_at"); filters["emailView"] = .string("inbox")
            filters["ef"] = and(literal("InboxVisible", .bool(true)), literal("Importance", .bool(collection == .signal)), literal("Shared", .string("exclude")))
            if collection == .signal {
                let active = or(literal("ns", .string("unseen")), literal("ns", .string("seen")))
                let twoWeeksAgo = MessageDate.string(Calendar.current.startOfDay(for: Date()).addingTimeInterval(-14 * 86_400))
                let recent = literal("ua", .object(["gte": .string(twoWeeksAgo)]))
                for key in ["df", "cf", "pf"] { filters[key] = and(active, recent) }
                filters["ef"] = and(filters["ef"]!, recent)
                filters["chanf"] = or(literal("NotificationState", .string("unseen")), literal("NotificationState", .string("seen")))
                filters["cthf"] = filters["chanf"]
                filters["calf"] = active; filters["asf"] = .object(["l": .string("inc")]); filters["remf"] = .object(["l": .string("inc")])
            }
        }
        return .object(filters)
    }

    private static func isRecentFile(_ item: WorkspaceItem) -> Bool {
        guard item.kind == .document else { return false }
        let subtype = item.payload["subType"]["type"].string ?? item.payload["sub_type"]["type"].string
            ?? item.payload["subType"].string ?? item.payload["sub_type"].string
        return subtype != "snippet" && item.payload["isEmailAttachment"].bool != true && item.payload["is_email_attachment"].bool != true
    }

    private func demoPage(_ collection: WorkspaceCollection, cursor: String?) -> WorkspacePage {
        guard cursor == nil else { return WorkspacePage(items: []) }
        return WorkspacePage(items: demoItems.filter { item in
            switch collection {
            case .signal: return demoSignalIDs.contains(item.id) && !demoDoneIDs.contains(item.id)
            case .noise: return demoNoiseIDs.contains(item.id) && !demoDoneIDs.contains(item.id)
            case .recent: return Self.isRecentFile(item)
            case .myFiles: return item.kind == .document && item.ownerID == userID
            case .sharedFiles: return item.kind == .document && item.ownerID != userID
            case .allFiles: return item.kind == .document
            case .folders: return item.kind == .folder
            case .tasks: return item.kind == .task
            case .agents: return item.kind == .agent || item.kind == .chat
            case .calls: return item.kind == .call
            }
        })
    }
}

enum WorkspaceFixtures {
    static func items(userID: String) -> [WorkspaceItem] {
        let date = "2026-09-27T14:30:00.000Z"
        return [
            WorkspaceItem(id: "workspace-design", kind: .document, title: "Mobile launch plan", subtitle: "Goals, launch checklist, and decisions", updatedAt: date, ownerID: userID, fileType: "md", projectID: "workspace-folder", isFavorite: true, isUnread: true),
            WorkspaceItem(id: "workspace-shared", kind: .document, title: "Product roadmap", subtitle: "Shared by Maya", updatedAt: date, ownerID: "macro|maya@macro.local", fileType: "spreadsheet"),
            WorkspaceItem(id: "workspace-folder", kind: .folder, title: "Launch", subtitle: "Plans and product documents", updatedAt: date, ownerID: userID, entityType: "project"),
            WorkspaceItem(id: "workspace-task", kind: .task, title: "Review the iPhone experience", subtitle: "High priority", updatedAt: date, ownerID: userID, fileType: "md", isUnread: true, status: "In progress"),
            WorkspaceItem(id: "workspace-channel", kind: .channel, title: "Research room", subtitle: "A channel reached from Home", updatedAt: date, ownerID: userID, isUnread: true, channelID: "workspace-channel", entityType: "channel", payload: .object(["channel_type": .string("public"), "is_participant": .bool(true), "participants": .array([.object(["user_id": .string(userID)])])])),
            WorkspaceItem(id: "workspace-agent", kind: .agent, title: "Research launch checklist", subtitle: "Finished — ready for review", updatedAt: date, ownerID: userID, isUnread: true, status: "session/end", entityType: "agent_session"),
            WorkspaceItem(id: "workspace-call", kind: .call, title: "Design sync", subtitle: "Maya and you · 18 minutes", updatedAt: date, ownerID: userID, status: "ATTENDED", channelID: "channel-general", entityType: "call"),
            WorkspaceItem(id: "demo-email-design", kind: .email, title: "A few thoughts on the mobile design", subtitle: "Jamie · Native navigation and the conversation composer", updatedAt: date, ownerID: userID, entityType: "email_thread", payload: .object(["senderName": .string("Jamie Chen"), "senderEmail": .string("jamie@macro.local")])),
        ]
    }

    static func callRecord(id: String, userID: String) -> WorkspaceCallRecord {
        WorkspaceCallRecord(callId: id, channelId: "channel-general", channelName: "Design sync", customName: nil,
            createdBy: userID, startedAt: "2026-09-27T14:00:00Z", endedAt: "2026-09-27T14:18:00Z", durationMs: 1_080_000,
            isActive: false, summary: "Reviewed the launch plan and the iPhone messaging experience. Next: test mentions and keyboard navigation.",
            recordingUrl: nil, recordingPreviewUrl: nil, participants: [WorkspaceCallParticipant(userId: userID, joinedAt: "2026-09-27T14:00:00Z", leftAt: "2026-09-27T14:18:00Z")],
            transcript: [WorkspaceTranscriptSegment(transcriptId: "demo-transcript", speakerId: userID, content: "Let's make the conversation feel immediate.", startedAt: "2026-09-27T14:01:00Z", endedAt: nil, sequenceNum: 0)])
    }
}
