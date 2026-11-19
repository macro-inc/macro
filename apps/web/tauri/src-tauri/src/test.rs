use super::navigation_plugin;
use url::Url;

/// The main webview runs the app with its native commands, so a page
/// navigation loads only the app's own documents. Any other page, including
/// Pipedream Connect, opens in the system browser: the webview's navigation
/// handler cannot tell a frame from the page, so allowing a third-party
/// document anywhere would also let it replace the app.
#[test]
fn main_webview_loads_only_the_apps_own_documents() {
    let navigation = navigation_plugin();

    for url in [
        "https://pipedream.com/_static/connect.html",
        "https://pipedream.com/_static/connect.html?token=ctok_1&app=github",
        "https://example.com/",
        "https://macro.com/pricing",
    ] {
        assert!(
            !navigation.loads_in_webview(&Url::parse(url).unwrap()),
            "{url}"
        );
    }

    for url in [
        "tauri://localhost/index.html",
        "http://tauri.localhost/index.html",
        "https://tauri.localhost/index.html",
    ] {
        assert!(
            navigation.loads_in_webview(&Url::parse(url).unwrap()),
            "{url}"
        );
    }
}
