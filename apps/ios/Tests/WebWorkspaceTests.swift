import XCTest
import WebKit
@testable import MacroNative

@MainActor
final class WebWorkspaceTests: XCTestCase {
    func testWorkspaceOriginAndBlobDownloadsAreRestrictedToSelectedEnvironment() {
        XCTAssertEqual(WorkspaceWebPolicy.downloadName("../../report.pdf"), "report.pdf")
        XCTAssertEqual(WorkspaceWebPolicy.downloadName(".."), "Download")
        let origin = URL(string: "https://macro.com/app")!
        XCTAssertTrue(WorkspaceWebPolicy.isWorkspaceURL(URL(string: "https://macro.com/app/document/id")!, webOrigin: origin))
        XCTAssertFalse(WorkspaceWebPolicy.isWorkspaceURL(URL(string: "https://dev.macro.com/app/document/id")!, webOrigin: origin))
        XCTAssertFalse(WorkspaceWebPolicy.isWorkspaceURL(URL(string: "https://macro.com.attacker.invalid/app")!, webOrigin: origin))
        XCTAssertFalse(WorkspaceWebPolicy.isWorkspaceURL(URL(string: "https://macro.com:8443/app")!, webOrigin: origin))
        XCTAssertTrue(WorkspaceWebPolicy.isWorkspaceBlob(URL(string: "blob:https://macro.com/local-export")!, webOrigin: origin))
        XCTAssertFalse(WorkspaceWebPolicy.isWorkspaceBlob(URL(string: "blob:https://example.invalid/local-export")!, webOrigin: origin))
        XCTAssertTrue(WorkspaceWebPolicy.isLoginURL(URL(string: "https://macro.com/app/welcome/")!, webOrigin: origin))
        XCTAssertFalse(WorkspaceWebPolicy.isLoginURL(URL(string: "https://macro.com/app/document/id")!, webOrigin: origin))
    }

    func testNativeDockStyleHidesOnlyWebDockAndPreservesEditorControls() async throws {
        let html = "<html><head><style>\(WorkspaceWebPolicy.nativeChromeCSS)</style></head><body><div data-float-region='dock'>Web navigation</div><div data-float-region='accessory'><button id='editor'>Document controls</button></div><main id='document'>My document</main></body></html>"
        let browser = WKWebView(frame: .zero, configuration: configuration())
        let delegate = WebTestNavigationDelegate(expectation: expectation(description: "Local fixture loaded"))
        browser.navigationDelegate = delegate
        browser.loadHTMLString(html, baseURL: nil)
        await fulfillment(of: [delegate.expectation], timeout: 10)
        let result = try await browser.evaluateJavaScript("[getComputedStyle(document.querySelector('[data-float-region=dock]')).visibility, getComputedStyle(document.querySelector('[data-float-region=accessory]')).display, document.querySelector('#editor').textContent, document.querySelector('#document').textContent]") as? [String]
        XCTAssertEqual(result?[0], "hidden")
        let reservedHeight = try await browser.evaluateJavaScript("document.querySelector('[data-float-region=dock]').getBoundingClientRect().height") as? Double
        XCTAssertGreaterThan(reservedHeight ?? 0, 0, "The native dock must retain the web accessory’s bottom clearance")
        XCTAssertNotEqual(result?[1], "none")
        XCTAssertEqual(result?[2], "Document controls")
        XCTAssertEqual(result?[3], "My document")
    }

    func testChromeScriptDoesNotInjectIntoAnUntrustedPage() async throws {
        let config = configuration()
        config.userContentController.addUserScript(WKUserScript(source: WorkspaceWebPolicy.chromeScript(webOrigin: URL(string: "https://macro.com/app")!), injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        let browser = WKWebView(frame: .zero, configuration: config)
        let delegate = WebTestNavigationDelegate(expectation: expectation(description: "Untrusted local fixture loaded"))
        browser.navigationDelegate = delegate
        browser.loadHTMLString("<html><body><div data-float-region='dock'>Navigation</div></body></html>", baseURL: nil)
        await fulfillment(of: [delegate.expectation], timeout: 10)
        let inserted = try await browser.evaluateJavaScript("document.getElementById('macro-native-navigation') !== null") as? Bool
        XCTAssertEqual(inserted, false)
    }

    private func configuration() -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent(); return config
    }
}

@MainActor private final class WebTestNavigationDelegate: NSObject, WKNavigationDelegate {
    let expectation: XCTestExpectation
    init(expectation: XCTestExpectation) { self.expectation = expectation }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { expectation.fulfill() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { XCTFail(error.localizedDescription); expectation.fulfill() }
}
