import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {

    private let appGroupId = "group.com.macro.app.prod"
    private let appURLScheme = "macro"

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        // A fully transparent view can cause the system to dismiss the extension
        // before it has a chance to do anything. Use a near-transparent scrim instead.
        view.backgroundColor = UIColor.black.withAlphaComponent(0.01)

        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            self?.complete()
        }

        processSharedItems()
    }

    // MARK: - Main flow

    private func processSharedItems() {
        guard
            let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem,
            let attachments = extensionItem.attachments,
            !attachments.isEmpty
        else {
            complete()
            return
        }

        let group = DispatchGroup()
        var savedFilenames: [String] = []
        let lock = NSLock()

        for provider in attachments {
            let imageType = UTType.image.identifier
            let movieType = UTType.movie.identifier
            let urlType = UTType.url.identifier

            if provider.hasItemConformingToTypeIdentifier(imageType) {
                group.enter()
                loadData(from: provider, typeIdentifier: imageType, defaultExt: "jpg") { [weak self] data, ext in
                    defer { group.leave() }
                    if let data, let name = self?.saveToAppGroup(data: data, ext: ext) {
                        lock.withLock { savedFilenames.append(name) }
                    }
                }
            } else if provider.hasItemConformingToTypeIdentifier(movieType) {
                group.enter()
                loadData(from: provider, typeIdentifier: movieType, defaultExt: "mp4") { [weak self] data, ext in
                    defer { group.leave() }
                    if let data, let name = self?.saveToAppGroup(data: data, ext: ext) {
                        lock.withLock { savedFilenames.append(name) }
                    }
                }
            } else if provider.hasItemConformingToTypeIdentifier(urlType) {
                group.enter()
                loadURLData(from: provider, typeIdentifier: urlType) { [weak self] data in
                    defer { group.leave() }
                    if let data, let name = self?.saveToAppGroup(data: data, ext: "url") {
                        lock.withLock { savedFilenames.append(name) }
                    }
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            if savedFilenames.isEmpty {
                self.complete()
            } else {
                self.openMainApp(filenames: savedFilenames)
            }
        }
    }

    // MARK: - Data loading

    /// Load raw data from an NSItemProvider.
    /// Uses loadDataRepresentation (designed for Share Extensions) and falls back
    /// to loadItem if that fails.
    private func loadData(
        from provider: NSItemProvider,
        typeIdentifier: String,
        defaultExt: String,
        completion: @escaping (Data?, String) -> Void
    ) {
        provider.loadDataRepresentation(forTypeIdentifier: typeIdentifier) { data, _ in
            if let data {
                completion(data, defaultExt)
                return
            }

            // Fallback: loadItem covers UIImage / NSURL paths
            provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, _ in
                if let url = item as? URL, url.isFileURL {
                    let ext = url.pathExtension.isEmpty ? defaultExt : url.pathExtension
                    completion(try? Data(contentsOf: url), ext)
                } else if let image = item as? UIImage {
                    completion(image.jpegData(compressionQuality: 0.9), "jpg")
                } else if let rawData = item as? Data {
                    completion(rawData, defaultExt)
                } else {
                    completion(nil, defaultExt)
                }
            }
        }
    }

    private func loadURLData(
        from provider: NSItemProvider,
        typeIdentifier: String,
        completion: @escaping (Data?) -> Void
    ) {
        provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, _ in
            let url: URL?
            if let itemURL = item as? URL {
                url = itemURL
            } else if let itemString = item as? String {
                url = URL(string: itemString)
            } else if let itemData = item as? Data,
                      let itemString = String(data: itemData, encoding: .utf8) {
                url = URL(string: itemString.trimmingCharacters(in: .whitespacesAndNewlines))
            } else {
                url = nil
            }

            completion(url?.absoluteString.appending("\n").data(using: .utf8))
        }
    }

    // MARK: - App Group storage

    private func saveToAppGroup(data: Data, ext: String) -> String? {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        ) else {
            return nil
        }

        let filename = "share_\(UUID().uuidString).\(ext)"
        let fileURL = container.appendingPathComponent(filename)
        do {
            try data.write(to: fileURL)
            return filename
        } catch {
            return nil
        }
    }

    // MARK: - Opening the main app

    private func openMainApp(filenames: [String]) {
        var components = URLComponents()
        components.scheme = appURLScheme
        components.host = "share"
        components.queryItems = [
            URLQueryItem(name: "files", value: filenames.joined(separator: ","))
        ]

        guard let url = components.url else {
            complete()
            return
        }

        // Walk up the responder chain looking for the UIApplication instance.
        var foundViaChain = false
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                app.open(url, options: [:], completionHandler: nil)
                foundViaChain = true
                break
            }
            responder = r.next
        }

        // Fallback: use extensionContext to open the URL.
        // UIApplication.shared is unavailable in extensions; extensionContext?.open
        // is the supported API for launching the host app from any extension type.
        if !foundViaChain {
            extensionContext?.open(url, completionHandler: nil)
        }

        complete()
    }

    // MARK: - Helpers

    private func complete() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
