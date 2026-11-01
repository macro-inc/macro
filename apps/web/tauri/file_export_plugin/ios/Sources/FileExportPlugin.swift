import Foundation
import UIKit
import Tauri

private struct BeginExport: Decodable {
    let name: String
    let size: Int64
}

private struct AppendExport: Decodable {
    let token: String
    let data: String
}

private struct ExportToken: Decodable {
    let token: String
}

private struct FinishExport: Decodable {
    let token: String
    let action: String
}

private struct StagedExport {
    let url: URL
    let size: Int64
    var written: Int64 = 0
    var updatedAt = Date()
}

@available(iOS 14.0, *)
class FileExportPlugin: Plugin, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    // Disk operations and transfer state stay on one queue, away from UIKit.
    private let worker = DispatchQueue(label: "com.macro.file-export", qos: .userInitiated)
    private let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("macro-file-exports", isDirectory: true)
    private var staged: [String: StagedExport] = [:]
    private var presentingTokens: Set<String> = []
    // The currently presented chooser is owned exclusively by the main queue.
    private var current: (token: String, export: StagedExport, invoke: Invoke, action: String)?
    private weak var chooser: UIViewController?

    @objc public func available(_ invoke: Invoke) {
        invoke.resolve(true)
    }

    @objc public func beginExport(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(BeginExport.self)
        worker.async {
            self.cleanupStaleFiles()
            guard args.size >= 0, args.size <= 500 * 1024 * 1024, self.staged.count < 4 else {
                invoke.reject("File export exceeds the 500 MB or active-transfer limit")
                return
            }
            let name = (args.name as NSString).lastPathComponent
            guard !name.isEmpty, name != ".", name != "..", !name.contains("\0") else {
                invoke.reject("Invalid filename")
                return
            }
            let token = UUID().uuidString
            let folder = self.directory.appendingPathComponent(token, isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let url = folder.appendingPathComponent(name)
                try Data().write(to: url)
                self.staged[token] = StagedExport(url: url, size: args.size)
                invoke.resolve(["token": token])
            } catch {
                try? FileManager.default.removeItem(at: folder)
                invoke.reject("Unable to prepare file: \(error.localizedDescription)")
            }
        }
    }

    @objc public func appendExport(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AppendExport.self)
        worker.async {
            guard var export = self.staged[args.token] else {
                invoke.reject("Unknown file export")
                return
            }
            guard args.data.utf8.count <= 350_000,
                  let data = Data(base64Encoded: args.data),
                  data.count <= 256 * 1024,
                  export.written + Int64(data.count) <= export.size else {
                invoke.reject("Invalid file chunk")
                return
            }
            do {
                let handle = try FileHandle(forWritingTo: export.url)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
                export.written += Int64(data.count)
                export.updatedAt = Date()
                self.staged[args.token] = export
                invoke.resolve()
            } catch {
                invoke.reject("Unable to write file: \(error.localizedDescription)")
            }
        }
    }

    @objc public func finishExport(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(FinishExport.self)
        worker.async {
            guard args.action == "save" || args.action == "share",
                  let export = self.staged[args.token], export.written == export.size else {
                invoke.reject("Incomplete or invalid file export")
                return
            }
            self.staged.removeValue(forKey: args.token)
            self.presentingTokens.insert(args.token)
            DispatchQueue.main.async {
                guard self.current == nil,
                      let root = self.manager.viewController ?? UIApplication.shared.connectedScenes
                        .compactMap({ $0 as? UIWindowScene })
                        .filter({ $0.activationState == .foregroundActive })
                        .flatMap({ $0.windows })
                        .first(where: { $0.isKeyWindow })?.rootViewController else {
                    self.remove(export)
                    invoke.reject("A file chooser cannot be opened right now")
                    return
                }
                var presenter = root
                while let presented = presenter.presentedViewController {
                    presenter = presented
                }
                guard presenter.viewIfLoaded?.window != nil,
                      !presenter.isBeingDismissed, !presenter.isBeingPresented else {
                    self.remove(export)
                    invoke.reject("The app is not ready to present a file chooser")
                    return
                }
                self.current = (args.token, export, invoke, args.action)
                let controller: UIViewController
                if args.action == "save" {
                    let picker = UIDocumentPickerViewController(forExporting: [export.url], asCopy: true)
                    picker.delegate = self
                    controller = picker
                } else {
                    let sheet = UIActivityViewController(activityItems: [export.url], applicationActivities: nil)
                    sheet.completionWithItemsHandler = { [weak self] _, completed, _, error in
                        self?.complete(token: args.token, canceled: !completed, error: error)
                    }
                    if let popover = sheet.popoverPresentationController {
                        popover.sourceView = presenter.view
                        popover.sourceRect = CGRect(x: presenter.view.bounds.midX,
                                                    y: presenter.view.bounds.midY,
                                                    width: 1, height: 1)
                        popover.permittedArrowDirections = []
                    }
                    controller = sheet
                }
                self.chooser = controller
                controller.presentationController?.delegate = self
                presenter.present(controller, animated: true)
            }
        }
    }

    @objc public func discardExport(_ invoke: Invoke) throws {
        let token = try invoke.parseArgs(ExportToken.self).token
        worker.async {
            if let export = self.staged.removeValue(forKey: token) {
                try? FileManager.default.removeItem(at: export.url.deletingLastPathComponent())
            }
            DispatchQueue.main.async {
                if self.current?.token == token {
                    self.chooser?.dismiss(animated: true)
                    self.complete(token: token, canceled: true)
                }
                invoke.resolve()
            }
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard chooser === controller, let token = current?.token else { return }
        complete(token: token, canceled: urls.isEmpty)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard chooser === controller, let token = current?.token else { return }
        complete(token: token, canceled: true)
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        guard chooser === presentationController.presentedViewController,
              let token = current?.token else { return }
        complete(token: token, canceled: true)
    }

    private func complete(token: String, canceled: Bool, error: Error? = nil) {
        guard let session = current, session.token == token else { return }
        current = nil
        chooser = nil
        // Share extensions can read after handoff. Retain successful shares for
        // the same 24-hour grace period as Android, then clean on the next export.
        if session.action == "save" || canceled || error != nil {
            remove(session.export)
        } else {
            worker.async { self.presentingTokens.remove(token) }
        }
        if let error = error {
            session.invoke.reject("Unable to export file: \(error.localizedDescription)")
        } else {
            session.invoke.resolve(["canceled": canceled])
        }
    }

    private func remove(_ export: StagedExport) {
        worker.async {
            self.presentingTokens.remove(export.url.deletingLastPathComponent().lastPathComponent)
            try? FileManager.default.removeItem(at: export.url.deletingLastPathComponent())
        }
    }

    private func cleanupStaleFiles() {
        // WebContent can reload before JS's finally runs. Expire stalled
        // transfers before counting slots so orphaned tokens cannot wedge exports.
        let transferCutoff = Date().addingTimeInterval(-5 * 60)
        for (token, export) in staged where export.updatedAt < transferCutoff {
            staged.removeValue(forKey: token)
            try? FileManager.default.removeItem(at: export.url.deletingLastPathComponent())
        }
        guard let folders = try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.contentModificationDateKey]
        ) else { return }
        let cutoff = Date().addingTimeInterval(-24 * 60 * 60)
        for folder in folders {
            if staged[folder.lastPathComponent] != nil || presentingTokens.contains(folder.lastPathComponent) { continue }
            let modified = try? folder.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
            if let modified = modified, modified < cutoff {
                try? FileManager.default.removeItem(at: folder)
            }
        }
    }
}

@_cdecl("init_plugin_file_export")
func initPlugin() -> Plugin {
    if #available(iOS 14.0, *) { return FileExportPlugin() }
    return UnavailableFileExportPlugin()
}

private class UnavailableFileExportPlugin: Plugin {
    @objc public func available(_ invoke: Invoke) { invoke.resolve(false) }
}
