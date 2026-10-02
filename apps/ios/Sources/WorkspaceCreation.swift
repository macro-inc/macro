import Foundation

enum WorkspaceBlankResource: String, CaseIterable, Sendable {
    case document, canvas, spreadsheet, folder, code, snippet
    var title: String {
        switch self { case .snippet: "Snippet"; case .document: "Document"; case .canvas: "Canvas"; case .spreadsheet: "Spreadsheet"; case .folder: "Folder"; case .code: "Code" }
    }
    var defaultName: String {
        switch self { case .snippet, .document: ""; case .canvas: "New Canvas"; case .spreadsheet: "Untitled spreadsheet"; case .folder: "New Folder"; case .code: "New Code File" }
    }
    var fileType: String {
        switch self { case .snippet, .document: "md"; case .canvas: "canvas"; case .spreadsheet: "spreadsheet"; case .folder: ""; case .code: "py" }
    }
    var initialData: Data {
        switch self {
        case .canvas: Data(#"{"nodes":[],"edges":[]}"#.utf8)
        case .code: Data(#"print("Hello, World!")"#.utf8)
        default: Data()
        }
    }
    var contentType: String { self == .canvas ? "application/x-macro-canvas" : "text/plain" }
    var icon: String {
        switch self { case .snippet: "text-align-left"; case .document: "file-text"; case .canvas: "flow-arrow"; case .spreadsheet: "table"; case .folder: "folder"; case .code: "code" }
    }
}
