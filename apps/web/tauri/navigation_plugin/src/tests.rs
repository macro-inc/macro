use super::*;
use crate::scheme::MacroScheme;

/// Mirrors the app's real config: the allowlist holds only the SPA's own
/// origins, and the macro hosts are app-link hosts.
fn test_plugin() -> MacroNavigationPlugin {
    MacroNavigationPlugin::new(&[
        "tauri://localhost",
        "http://tauri.localhost",
        "http://localhost:3000",
    ])
    .unwrap()
    .with_app_link_hosts(&["macro.com", "dev.macro.com", "staging.macro.com"])
}

#[test]
fn get_destination_app_link_for_macro_app_path() {
    let plugin = test_plugin();
    let url = Url::parse("https://macro.com/app/component/doc123").unwrap();
    match plugin.get_destination(&url) {
        NavigationOutput::AppLink(scheme) => {
            assert_eq!(scheme.path(), "/component/doc123");
            assert_eq!(scheme.query(), None);
        }
        other => panic!("expected AppLink, got {other:?}"),
    }
}

#[test]
fn get_destination_app_link_preserves_query() {
    let plugin = test_plugin();
    let url = Url::parse("https://dev.macro.com/app/component/doc123?foo=bar").unwrap();
    match plugin.get_destination(&url) {
        NavigationOutput::AppLink(scheme) => {
            assert_eq!(scheme.path(), "/component/doc123");
            assert_eq!(scheme.query(), Some("foo=bar"));
        }
        other => panic!("expected AppLink, got {other:?}"),
    }
}

#[test]
fn get_destination_app_link_strips_www() {
    let plugin = test_plugin();
    let url = Url::parse("https://www.macro.com/app/component/doc123").unwrap();
    assert!(matches!(
        plugin.get_destination(&url),
        NavigationOutput::AppLink(_)
    ));
}

#[test]
fn get_destination_external_for_non_app_path_on_macro_host() {
    let plugin = test_plugin();
    for url in ["https://macro.com/pricing", "https://dev.macro.com/pricing"] {
        assert!(
            matches!(
                plugin.get_destination(&Url::parse(url).unwrap()),
                NavigationOutput::External(_)
            ),
            "{url}"
        );
    }
}

#[test]
fn get_destination_external_for_app_path_on_foreign_host() {
    let plugin = test_plugin();
    let url = Url::parse("https://auth-service.macro.com/app/component/doc123").unwrap();
    assert!(matches!(
        plugin.get_destination(&url),
        NavigationOutput::External(_)
    ));
}

#[test]
fn get_destination_internal_for_spa_origins() {
    let plugin = test_plugin();
    for url in [
        "tauri://localhost/index.html",
        "http://tauri.localhost/index.html",
        "http://localhost:3000/component/abc",
    ] {
        assert!(
            matches!(
                plugin.get_destination(&Url::parse(url).unwrap()),
                NavigationOutput::Internal
            ),
            "{url}"
        );
    }
}

/// If an app-link host is ever (re-)added to the allowlist, `/app` paths must
/// still be routed as app links instead of full-page loading the remote site
/// in the webview — the app-link check runs before the allowlist.
#[test]
fn get_destination_app_link_wins_over_allowlist() {
    let plugin = MacroNavigationPlugin::new(&["https://macro.com"])
        .unwrap()
        .with_app_link_hosts(&["macro.com"]);
    let app_url = Url::parse("https://macro.com/app/component/doc123").unwrap();
    assert!(matches!(
        plugin.get_destination(&app_url),
        NavigationOutput::AppLink(_)
    ));
    let site_url = Url::parse("https://macro.com/pricing").unwrap();
    assert!(matches!(
        plugin.get_destination(&site_url),
        NavigationOutput::Internal
    ));
}

#[test]
fn get_destination_no_app_link_hosts_keeps_old_behavior() {
    let plugin = MacroNavigationPlugin::new(&["https://macro.com"]).unwrap();
    let url = Url::parse("https://macro.com/app/component/doc123").unwrap();
    assert!(matches!(
        plugin.get_destination(&url),
        NavigationOutput::Internal
    ));
}

#[test]
fn popup_and_main_frame_share_external_url_policy() {
    let plugin = test_plugin();
    for input in [
        "https://github.com/macro-inc/macro/pull/7858",
        "http://example.com/",
        "mailto:hello@example.com",
        "tel:+15551234567",
        "codex://new?prompt=hello",
        "cursor://anysphere.cursor-deeplink/prompt?text=hello",
        "zed://agent?prompt=hello",
    ] {
        let url = Url::parse(input).unwrap();
        for destination in [
            plugin.get_destination(&url),
            plugin.new_window_destination(&url),
        ] {
            match destination {
                NavigationOutput::External(external) => assert_eq!(external.0.as_ref(), &url),
                other => panic!("expected External for {url}, got {other:?}"),
            }
        }
    }
}

#[test]
fn popup_app_links_include_same_origin_and_macro_scheme() {
    let plugin = test_plugin();
    for input in [
        "https://macro.com/app/mail?view=all",
        "https://dev.macro.com/app/mail?view=all",
        "https://www.macro.com/app/mail?view=all",
        "macro:///mail?view=all",
        "tauri://localhost/app/mail?view=all",
        "http://tauri.localhost/app/mail?view=all",
        "http://localhost:3000/app/mail?view=all",
        "tauri://localhost/mail?view=all",
        "http://localhost:3000/mail?view=all",
    ] {
        let url = Url::parse(input).unwrap();
        match plugin.new_window_destination(&url) {
            NavigationOutput::AppLink(scheme) => {
                assert_eq!(scheme.path(), "/mail", "{url}");
                assert_eq!(scheme.query(), Some("view=all"), "{url}");
            }
            other => panic!("expected AppLink for {url}, got {other:?}"),
        }
    }
}

#[test]
fn standalone_html_popup_remains_internal_and_is_allowed() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tauri::Listener;

    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let received = Arc::new(AtomicUsize::new(0));
    let events = received.clone();
    app.listen("navigate", move |_| {
        events.fetch_add(1, Ordering::Relaxed);
    });

    let plugin = test_plugin();
    for input in [
        "http://localhost:3000/billing-lab.html",
        "http://localhost:3000/billing-lab.html?scenario=paid#details",
        "tauri://localhost/billing-lab.html",
        "http://tauri.localhost/another-document.html",
    ] {
        let url = Url::parse(input).unwrap();
        assert!(
            matches!(
                plugin.new_window_destination(&url),
                NavigationOutput::Internal
            ),
            "{url}"
        );
        assert!(
            matches!(
                plugin.on_new_window(app.handle(), &url),
                tauri::webview::NewWindowResponse::Allow
            ),
            "{url}"
        );
    }
    assert_eq!(received.load(Ordering::Relaxed), 0);
}

#[test]
fn standalone_html_does_not_bypass_origin_policy() {
    let plugin = test_plugin();
    for input in [
        "https://example.com/billing-lab.html",
        "http://localhost:9999/billing-lab.html",
    ] {
        assert!(
            matches!(
                plugin.new_window_destination(&Url::parse(input).unwrap()),
                NavigationOutput::External(_)
            ),
            "{input}"
        );
    }
    assert!(matches!(
        plugin.new_window_destination(&Url::parse("file:///etc/billing-lab.html").unwrap()),
        NavigationOutput::Blocked
    ));
}

#[test]
fn browser_only_urls_and_untrusted_local_files_are_blocked() {
    let plugin = test_plugin();
    for input in [
        "about:blank",
        "javascript:alert(1)",
        "data:text/html,test",
        "blob:tauri://localhost/123",
        "file:///etc/passwd",
    ] {
        let url = Url::parse(input).unwrap();
        assert!(
            matches!(plugin.get_destination(&url), NavigationOutput::Blocked),
            "{url}"
        );
        assert!(
            matches!(
                plugin.new_window_destination(&url),
                NavigationOutput::Blocked
            ),
            "{url}"
        );
    }
}

#[test]
fn popup_app_link_emits_once_and_never_creates_a_webview() {
    use std::sync::Mutex;
    use tauri::Listener;

    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let received = Arc::new(Mutex::new(Vec::new()));
    let events = received.clone();
    app.listen("navigate", move |event| {
        events
            .lock()
            .unwrap()
            .push(serde_json::from_str::<serde_json::Value>(event.payload()).unwrap());
    });

    let response = test_plugin().on_new_window(
        app.handle(),
        &Url::parse("https://macro.com/app/mail?view=all").unwrap(),
    );

    assert!(matches!(response, tauri::webview::NewWindowResponse::Deny));
    assert_eq!(
        *received.lock().unwrap(),
        vec![serde_json::json!({"path": "/mail", "query": "view=all"})],
    );
    assert!(app.webview_windows().is_empty());
}

#[test]
fn blocked_popup_neither_opens_nor_emits_navigation() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tauri::Listener;

    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let received = Arc::new(AtomicUsize::new(0));
    let events = received.clone();
    app.listen("navigate", move |_| {
        events.fetch_add(1, Ordering::Relaxed);
    });
    // No opener plugin is installed: browser-only URLs must never reach it.
    let response = test_plugin().on_new_window(app.handle(), &Url::parse("about:blank").unwrap());
    assert!(matches!(response, tauri::webview::NewWindowResponse::Deny));
    assert_eq!(received.load(Ordering::Relaxed), 0);
}

#[test]
fn from_url_extracts_correct_path_from_universal_link() {
    let url = Url::parse("https://macro.com/app/component/doc123").unwrap();
    let result = MacroScheme::from_url(&url).unwrap();
    assert_eq!(result.path(), "/component/doc123");
    assert_eq!(result.query(), None);
}

#[test]
fn from_url_extracts_path_and_query_from_universal_link() {
    let url = Url::parse("https://macro.com/app/component/doc123?foo=bar").unwrap();
    let result = MacroScheme::from_url(&url).unwrap();
    assert_eq!(result.path(), "/component/doc123");
    assert_eq!(result.query(), Some("foo=bar"));
}

#[test]
fn from_url_strips_bare_app_path() {
    let url = Url::parse("https://macro.com/app").unwrap();
    let result = MacroScheme::from_url(&url).unwrap();
    assert_eq!(result.path(), "/");
}

#[test]
fn from_url_handles_nested_path() {
    let url = Url::parse("https://macro.com/app/component/nested/path/here").unwrap();
    let result = MacroScheme::from_url(&url).unwrap();
    assert_eq!(result.path(), "/component/nested/path/here");
}

#[test]
fn transform_external_url_adds_is_mobile_when_query_exists() {
    let url = Url::parse("https://example.com/path?foo=bar").unwrap();
    let result = transform_external_url(url);
    assert_eq!(
        result.query_pairs().find(|(k, _)| k == "is_mobile"),
        Some((Cow::Borrowed("is_mobile"), Cow::Borrowed("true")))
    );
}

#[test]
fn transform_external_url_no_query_does_not_add_is_mobile() {
    let url = Url::parse("https://example.com/path").unwrap();
    let result = transform_external_url(url);
    assert_eq!(result.query_pairs().find(|(k, _)| k == "is_mobile"), None);
}

#[test]
fn transform_external_url_preserves_existing_is_mobile_true() {
    let url = Url::parse("https://example.com/path?is_mobile=true").unwrap();
    let result = transform_external_url(url);
    let is_mobile_count = result
        .query_pairs()
        .filter(|(k, _)| k == "is_mobile")
        .count();
    assert_eq!(is_mobile_count, 1);
    assert_eq!(
        result.query_pairs().find(|(k, _)| k == "is_mobile"),
        Some((Cow::Borrowed("is_mobile"), Cow::Borrowed("true")))
    );
}

#[test]
fn transform_external_url_preserves_existing_is_mobile_false() {
    let url = Url::parse("https://example.com/path?is_mobile=false").unwrap();
    let result = transform_external_url(url);
    let is_mobile_count = result
        .query_pairs()
        .filter(|(k, _)| k == "is_mobile")
        .count();
    assert_eq!(is_mobile_count, 1);
    assert_eq!(
        result.query_pairs().find(|(k, _)| k == "is_mobile"),
        Some((Cow::Borrowed("is_mobile"), Cow::Borrowed("false")))
    );
}

#[test]
fn transform_external_url_preserves_other_query_params() {
    let url = Url::parse("https://example.com/path?foo=bar&baz=qux").unwrap();
    let result = transform_external_url(url);
    assert_eq!(
        result.query_pairs().find(|(k, _)| k == "foo"),
        Some((Cow::Borrowed("foo"), Cow::Borrowed("bar")))
    );
    assert_eq!(
        result.query_pairs().find(|(k, _)| k == "baz"),
        Some((Cow::Borrowed("baz"), Cow::Borrowed("qux")))
    );
    assert_eq!(
        result.query_pairs().find(|(k, _)| k == "is_mobile"),
        Some((Cow::Borrowed("is_mobile"), Cow::Borrowed("true")))
    );
}
