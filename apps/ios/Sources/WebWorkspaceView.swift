import SwiftUI
import WebKit
import QuickLook

/// Full editors keep their web implementations while the app supplies native navigation.
struct WebWorkspaceView: View {
    let session: NativeSession
    let url: URL
    var integratedNavigation = false
    @State private var browser = WorkspaceBrowser()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var browser = browser
        ZStack(alignment: .top) {
            WorkspaceWebView(session: session, url: url, browser: browser, integratedNavigation: integratedNavigation)
                .ignoresSafeArea(.container, edges: integratedNavigation ? .top : [])
            if browser.isLoading || browser.isDownloading {
                ProgressView().padding(10).background(.regularMaterial, in: Capsule()).padding(.top, 8)
            }
            if let error = browser.error {
                ContentUnavailableView {
                    Label(browser.requiresSignIn ? "Sign-in needed" : "Couldn’t open workspace", systemImage: browser.requiresSignIn ? "person.crop.circle.badge.exclamationmark" : "wifi.exclamationmark")
                } description: { Text(error) } actions: {
                    Button("Try again") { browser.reload() }.buttonStyle(.borderedProminent)
                    if browser.requiresSignIn { Button("Sign in again") { Task { await session.signOut() } } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.systemBackground))
            }
        }
        .overlay(alignment: .topLeading) {
            if integratedNavigation {
                Button {
                    if let web = browser.webView, web.canGoBack { web.goBack() } else { dismiss() }
                } label: { MacroIcon(name: "caret-left", size: 24).frame(width: 46, height: 42.5) }
                    .buttonStyle(.plain).foregroundStyle(.primary).nativeGlass().padding(.leading, 12).padding(.top, 6)
                    .accessibilityLabel("Back").accessibilityIdentifier("document-back")
            }
        }
        .navigationTitle("Workspace").navigationBarTitleDisplayMode(.inline)
        .toolbar(integratedNavigation ? .hidden : .visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Back", systemImage: "chevron.left") { browser.webView?.goBack() }.disabled(!browser.canGoBack)
                    Button("Forward", systemImage: "chevron.right") { browser.webView?.goForward() }.disabled(!browser.canGoForward)
                    Button("Reload", systemImage: "arrow.clockwise") { browser.reload() }
                    Button("Open in Safari", systemImage: "safari") { UIApplication.shared.open(browser.webView?.url ?? url) }
                } label: { Image(systemName: "ellipsis.circle") }
                .accessibilityLabel("Document browser controls").accessibilityIdentifier("workspace-browser-controls")
            }
        }
        .sheet(item: $browser.downloadedFile) { file in
            WorkspaceFilePreview(url: file.url).onDisappear { file.remove() }
        }
        .alert("Couldn’t download file", isPresented: Binding(get: { browser.downloadError != nil }, set: { if !$0 { browser.downloadError = nil } })) {
            Button("OK") { browser.downloadError = nil }
        } message: { Text(browser.downloadError ?? "") }
    }
}

/// Only the app's exact web origin receives cookies and the small native-navigation style.
enum WorkspaceWebPolicy {
    // Keep the web dock's measured space so the document comment accessory stays
    // above native navigation; collapsing it shifts the composer under the dock.
    static let nativeChromeCSS = #"[data-float-region="dock"] { visibility: hidden !important; pointer-events: none !important; }"#
    static let nativeEditorCSS = #"[data-split-header] [data-header-island]:has(button[aria-label="Go Back"]) { display: none !important; } [data-split-header] > div.absolute.inset-0.flex { padding-left: 66px !important; }"#
    static func isWorkspaceURL(_ url: URL, webOrigin: URL) -> Bool {
        url.scheme == "https" && url.host == webOrigin.host && (url.port == nil || url.port == 443) && url.user == nil && url.password == nil
    }
    static func isWorkspaceBlob(_ url: URL, webOrigin: URL) -> Bool {
        guard url.scheme == "blob", let nested = URL(string: String(url.absoluteString.dropFirst(5))) else { return false }
        return isWorkspaceURL(nested, webOrigin: webOrigin)
    }
    static func isLoginURL(_ url: URL, webOrigin: URL) -> Bool {
        let path = url.path.hasSuffix("/") ? String(url.path.dropLast()) : url.path
        return isWorkspaceURL(url, webOrigin: webOrigin) && ["/app/login", "/app/welcome", "/app/signup"].contains(path)
    }
    static func downloadName(_ suggested: String) -> String {
        let name = (suggested as NSString).lastPathComponent
        return name.isEmpty || name == "." || name == ".." ? "Download" : name
    }
    static func chromeScript(webOrigin: URL, integratedNavigation: Bool = false) -> String {
        let origin = "https://" + (webOrigin.host ?? "")
        let encodedOrigin = String(data: try! JSONEncoder().encode(origin), encoding: .utf8)!
        let encodedStyle = String(data: try! JSONEncoder().encode(nativeChromeCSS + (integratedNavigation ? nativeEditorCSS : "")), encoding: .utf8)!
        return """
        (() => {
          if (window.top !== window || window.location.origin !== \(encodedOrigin)) return;
          const style = document.createElement('style');
          style.id = 'macro-native-navigation';
          style.textContent = \(encodedStyle);
          (document.head || document.documentElement).appendChild(style);
        })();
        """
    }
}


@MainActor @Observable
private final class WorkspaceBrowser {
    var isLoading = true
    var isDownloading = false
    var canGoBack = false
    var canGoForward = false
    var requiresSignIn = false
    var error: String?
    var downloadError: String?
    var downloadedFile: WorkspaceDownloadedFile?
    @ObservationIgnored weak var webView: WKWebView?
    @ObservationIgnored var initialLoad: (() -> Void)?
    func reload() { error = nil; requiresSignIn = false; initialLoad?() }
}

private struct WorkspaceWebView: UIViewRepresentable {
    let session: NativeSession
    let url: URL
    let browser: WorkspaceBrowser
    let integratedNavigation: Bool
    func makeCoordinator() -> Coordinator { Coordinator(session: session, browser: browser, initialURL: url) }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = session.webDataStore
        configuration.allowsInlineMediaPlayback = true
        configuration.userContentController.addUserScript(WKUserScript(source: WorkspaceWebPolicy.chromeScript(webOrigin: session.environment.webURL, integratedNavigation: integratedNavigation), injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.keyboardDismissMode = .interactive
        if integratedNavigation { webView.scrollView.contentInsetAdjustmentBehavior = .never }
        browser.webView = webView
        configuration.websiteDataStore.httpCookieStore.add(context.coordinator)
        let coordinator = context.coordinator
        browser.initialLoad = { [weak webView, weak coordinator] in
            guard let webView, let coordinator else { return }
            let current = webView.url.flatMap { coordinator.isWorkspaceURL($0) && !coordinator.isLoginURL($0) ? $0 : nil }
            coordinator.load(url: current ?? url, in: webView)
        }
        coordinator.load(url: url, in: webView)
        return webView
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        coordinator.loadTask?.cancel()
        coordinator.cancelDownloads()
        uiView.stopLoading()
        uiView.configuration.websiteDataStore.httpCookieStore.remove(coordinator)
        uiView.navigationDelegate = nil
        uiView.uiDelegate = nil
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKHTTPCookieStoreObserver, WKDownloadDelegate {
        let session: NativeSession
        let browser: WorkspaceBrowser
        let initialURL: URL
        var loadTask: Task<Void, Never>?
        private var synchronizing = false
        private var attemptedRecovery = false
        private var downloads: [ObjectIdentifier: WKDownload] = [:]
        private var destinations: [ObjectIdentifier: URL] = [:]
        init(session: NativeSession, browser: WorkspaceBrowser, initialURL: URL) {
            self.session = session; self.browser = browser; self.initialURL = initialURL
        }
        func load(url: URL, in webView: WKWebView) {
            loadTask?.cancel()
            attemptedRecovery = false
            browser.error = nil; browser.requiresSignIn = false; browser.isLoading = true
            loadTask = Task { [weak self, weak webView] in
                guard let self, let webView else { return }
                do {
                    guard self.isWorkspaceURL(url) else { throw NativeSessionError.unsafeURL }
                    guard !self.session.isDemo else {
                        self.browser.isLoading = false
                        self.browser.error = "Sign in to your Macro account to open documents and spreadsheets. Preview mode stays offline."
                        return
                    }
                    self.synchronizing = true
                    defer { self.synchronizing = false }
                    try await self.session.synchronizeWebCookies(to: webView.configuration.websiteDataStore.httpCookieStore)
                    try Task.checkCancellation()
                    webView.load(URLRequest(url: url))
                } catch is CancellationError { return }
                catch { self.browser.isLoading = false; self.browser.error = error.localizedDescription }
            }
        }
        func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
            guard !synchronizing else { return }
            Task { await session.importWebCookies(from: cookieStore) }
        }
        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { browser.error = nil; browser.isLoading = true }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            browser.isLoading = false; browser.canGoBack = webView.canGoBack; browser.canGoForward = webView.canGoForward
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { browser.error = "The workspace stopped responding. Reload to continue."; browser.isLoading = false }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if action.targetFrame?.isMainFrame != false && isLoginURL(url) {
                decisionHandler(.cancel); recoverSession(in: webView); return
            }
            let localDownload = WorkspaceWebPolicy.isWorkspaceBlob(url, webOrigin: session.environment.webURL)
            if action.shouldPerformDownload && (isWorkspaceURL(url) || localDownload) { decisionHandler(.download); return }
            if action.targetFrame?.isMainFrame == false || isWorkspaceURL(url) || localDownload || url.absoluteString == "about:blank" {
                decisionHandler(.allow)
            } else { decisionHandler(.cancel); openExternal(url) }
        }
        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
            if !response.canShowMIMEType || disposition.hasPrefix("attachment") { decisionHandler(.download) } else { decisionHandler(.allow) }
        }
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard let url = action.request.url else { return nil }
            if isWorkspaceURL(url) { webView.load(action.request) } else { openExternal(url) }
            return nil
        }
        func isWorkspaceURL(_ url: URL) -> Bool { WorkspaceWebPolicy.isWorkspaceURL(url, webOrigin: session.environment.webURL) }
        func isLoginURL(_ url: URL) -> Bool { WorkspaceWebPolicy.isLoginURL(url, webOrigin: session.environment.webURL) }
        private func openExternal(_ url: URL) { if ["https", "http", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") { UIApplication.shared.open(url) } }

        private func recoverSession(in webView: WKWebView) {
            guard !attemptedRecovery else {
                browser.isLoading = false; browser.requiresSignIn = true
                browser.error = "The web editor couldn’t verify your session. Try again or sign in through the native app."
                return
            }
            attemptedRecovery = true
            loadTask?.cancel()
            loadTask = Task { [weak self, weak webView] in
                guard let self, let webView else { return }
                do {
                    self.session.invalidateAPIToken()
                    _ = try await self.session.macroAPIToken()
                    self.synchronizing = true
                    defer { self.synchronizing = false }
                    try await self.session.synchronizeWebCookies(to: webView.configuration.websiteDataStore.httpCookieStore)
                    try Task.checkCancellation()
                    webView.load(URLRequest(url: self.initialURL))
                } catch is CancellationError { return }
                catch { self.browser.isLoading = false; self.browser.error = error.localizedDescription; self.browser.requiresSignIn = true }
            }
        }
        private func failed(_ error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            browser.isLoading = false; browser.error = error.localizedDescription
        }
        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { begin(download) }
        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { begin(download) }
        private func begin(_ download: WKDownload) {
            download.delegate = self; downloads[ObjectIdentifier(download)] = download; browser.isDownloading = true; browser.isLoading = false
        }
        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            do {
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent("macro-download-\(UUID().uuidString)", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
                let file = folder.appendingPathComponent(WorkspaceWebPolicy.downloadName(suggestedFilename))
                destinations[ObjectIdentifier(download)] = file
                completionHandler(file)
            } catch { browser.downloadError = error.localizedDescription; completionHandler(nil) }
        }
        func downloadDidFinish(_ download: WKDownload) {
            let key = ObjectIdentifier(download)
            if let url = destinations.removeValue(forKey: key) { browser.downloadedFile = WorkspaceDownloadedFile(url: url) }
            downloads.removeValue(forKey: key); browser.isDownloading = !downloads.isEmpty
        }
        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            let key = ObjectIdentifier(download)
            if let url = destinations.removeValue(forKey: key) { WorkspaceDownloadedFile(url: url).remove() }
            downloads.removeValue(forKey: key); browser.isDownloading = !downloads.isEmpty
            if (error as NSError).code != NSURLErrorCancelled { browser.downloadError = error.localizedDescription }
        }
        func cancelDownloads() {
            for download in downloads.values { download.cancel { _ in } }
            for url in destinations.values { WorkspaceDownloadedFile(url: url).remove() }
            downloads.removeAll(); destinations.removeAll()
        }
    }
}

private struct WorkspaceDownloadedFile: Identifiable {
    var id = UUID()
    let url: URL
    func remove() { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
}

private struct WorkspaceFilePreview: UIViewControllerRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(url: url) }
    func makeUIViewController(context: Context) -> QLPreviewController { let controller = QLPreviewController(); controller.dataSource = context.coordinator; return controller }
    func updateUIViewController(_ controller: QLPreviewController, context: Context) {}
    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}
