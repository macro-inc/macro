import UIKit
import WebKit

/// Uses the current view's traits, never a device name, screen size, or main screen.
final class NativeLayoutObserver: UIView, WKScriptMessageHandler {
    private weak var webview: WKWebView?
    private var lastScript: String?
    private var keyboardScreenFrame: CGRect?
    private var lastKeyboardHeight: CGFloat?
    private var lastKeyboardVisible: Bool?

    init(webview: WKWebView) {
        self.webview = webview
        super.init(frame: webview.bounds)
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        backgroundColor = .clear
        autoresizingMask = [.flexibleWidth, .flexibleHeight]

        // Every document requests current traits after its root exists, including OTA reloads.
        let controller = webview.configuration.userContentController
        controller.add(self, name: "macroLayout")
        controller.addUserScript(WKUserScript(source: """
            document.addEventListener('DOMContentLoaded', () => {
                window.webkit.messageHandlers.macroLayout.postMessage(null);
            }, { once: true });
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webview.addSubview(self)
        // Complete the legacy will-show/hide bridge after frame changes, including
        // rotation, folding and connecting a hardware keyboard.
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardFrameChanged),
            name: UIResponder.keyboardDidChangeFrameNotification, object: nil)
        if #available(iOS 27.1, *) {
            registerForTraitChanges(UITraitCollection.systemTraitsAffectingVerticalBarEdge) {
                (view: NativeLayoutObserver, _: UITraitCollection) in view.publish()
            }
        }
        if #available(iOS 17.0, *) {
            registerForTraitChanges([UITraitHorizontalSizeClass.self, UITraitLayoutDirection.self]) {
                (view: NativeLayoutObserver, _: UITraitCollection) in view.publish()
            }
        }
        publish()
    }

    required init?(coder: NSCoder) { nil }

    func detach() {
        NotificationCenter.default.removeObserver(self)
        webview?.configuration.userContentController.removeScriptMessageHandler(forName: "macroLayout")
        removeFromSuperview()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        publish()
        publishKeyboard()
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        publish()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        publish()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame else { return }
        lastScript = nil
        lastKeyboardHeight = nil
        publish()
        publishKeyboard()
    }

    @objc private func keyboardFrameChanged(_ notification: Notification) {
        guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        keyboardScreenFrame = frame
        lastKeyboardHeight = nil
        publishKeyboard()
    }

    private func publishKeyboard() {
        guard let webview, let window = webview.window, let keyboardScreenFrame else { return }
        let frame = webview.convert(keyboardScreenFrame, from: window.screen.coordinateSpace)
        let overlap = webview.bounds.intersection(frame)
        // A floating keyboard must not shrink the entire app. Only docked
        // keyboard coverage at this webview's bottom edge reserves space.
        let height = !overlap.isNull && overlap.maxY >= webview.bounds.maxY - 1 ? overlap.height : 0
        let visible = !overlap.isNull && !overlap.isEmpty
        guard height != lastKeyboardHeight || visible != lastKeyboardVisible else { return }
        lastKeyboardHeight = height
        lastKeyboardVisible = visible
        let event = visible ? "keyboardWillShow" : "keyboardWillHide"
        webview.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(event)', {detail: {height: \(height), duration: 0}}));", completionHandler: nil)
    }

    private func publish() {
        guard let webview, webview.window != nil else { return }
        let traits = webview.traitCollection
        var edge = "bottom"
        if #available(iOS 27.1, *) {
            let rtl = webview.effectiveUserInterfaceLayoutDirection == .rightToLeft
            switch traits.verticalBarEdge {
            case .leading: edge = rtl ? "right" : "left"
            case .trailing: edge = rtl ? "left" : "right"
            default: break
            }
        }
        let sizeClass = traits.horizontalSizeClass == .compact ? "compact" : "regular"
        let script = """
            if (document.documentElement) {
                document.documentElement.dataset.nativeNavigationEdge = '\(edge)';
                document.documentElement.dataset.nativeHorizontalSizeClass = '\(sizeClass)';
            }
            """
        guard script != lastScript else { return }
        lastScript = script
        webview.evaluateJavaScript(script) { [weak self] _, error in
            if error != nil { self?.lastScript = nil }
        }
    }
}
