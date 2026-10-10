import Foundation

/// ACP session/load streams a replacement history before its reply. Those rows
/// become visible only after the matching successful reply; failed/incomplete
/// loads retain the last committed history and quarantine trailing replay rows.
enum NativeAgentReplay {
    static func committed(_ entries: [NativeAgentLogEntry]) -> [NativeAgentLogEntry] {
        var committed: [NativeAgentLogEntry] = [], candidate: [NativeAgentLogEntry]? = nil
        var loadingID: WorkspaceJSON?, openingID: WorkspaceJSON?
        var quarantined = false, seen = Set<String>()
        var modelMetadata: [NativeAgentLogEntry] = []
        for entry in entries where seen.insert(entry.id).inserted {
            let frame = entry.content, method = frame["method"].string
            if frame["type"].string == "event", ["acp_ready", "disconnected"].contains(frame["event"].string ?? "") {
                quarantined = quarantined || candidate != nil || frame["event"].string == "disconnected"
                candidate = nil; loadingID = nil; openingID = nil
                committed.append(entry); continue
            }
            if entry.direction == "to_runtime" {
                if method == "initialize" {
                    quarantined = quarantined || candidate != nil
                    candidate = nil; loadingID = nil; openingID = nil
                } else if method == "session/load", frame["params"]["sessionId"].string != nil, frame["id"] != .null {
                    candidate = [entry]; loadingID = frame["id"]; openingID = nil; continue
                } else if ["session/new", "session/resume"].contains(method ?? "") { openingID = frame["id"] }
                else if method == "session/prompt", candidate == nil { quarantined = false }
            }
            if entry.direction == "to_server", method == nil, frame["id"] != .null {
                if let expected = loadingID, frame["id"] == expected {
                    if frame["result"].object != nil {
                        committed = modelMetadata + (candidate ?? []) + [entry]; quarantined = false
                    } else { quarantined = true }
                    candidate = nil; loadingID = nil
                } else if frame["id"] == openingID, frame["result"].object != nil { quarantined = false; openingID = nil }
                if frame["result"]["models"].object != nil || !frame["result"]["configOptions"].array.isEmpty {
                    modelMetadata = [entry]
                }
            }
            if candidate != nil { candidate?.append(entry); continue }
            if quarantined, entry.direction == "to_server", ["session/update", "session/request_permission", "elicitation/create"].contains(method ?? "") { continue }
            if committed.last?.id != entry.id { committed.append(entry) }
        }
        return committed
    }
}
