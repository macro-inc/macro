import Tauri
import WebKit

final class LayoutPlugin: Plugin {
    private var observer: NativeLayoutObserver?

    override func load(webview: WKWebView) {
        observer?.detach()
        observer = NativeLayoutObserver(webview: webview)
    }
}

@_cdecl("init_plugin_layout")
func initPlugin() -> Plugin {
    LayoutPlugin()
}
