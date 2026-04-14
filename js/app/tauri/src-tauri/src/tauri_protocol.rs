// Wrapper around the upstream tauri protocol handler.
//
// Adds two behaviors on top of the built-in `tauri://` protocol:
// 1. Strips the `/app/` base path prefix before asset resolution
// 2. Checks `BundleRoot` state to serve from an OTA-updated bundle on disk
//
// When `BundleRoot` is `None`, the request (with `/app/` stripped) is forwarded
// to the upstream handler which handles dev proxy, CSP, security headers, etc.
// When `BundleRoot` is `Some(path)`, files are served directly from disk.

use http::{header::CONTENT_TYPE, Response as HttpResponse, StatusCode};
use tauri::{Manager, Runtime, UriSchemeResponder};

use macro_bundle_updater_plugin::BundleRoot;

/// Strip the `/app` or `/app/` prefix used as the frontend base path.
fn strip_app_prefix(path: &str) -> &str {
    path.strip_prefix("/app/")
        .or_else(|| path.strip_prefix("/app"))
        .unwrap_or(path)
}

/// Rewrite a URI by stripping the `/app/` prefix from the path portion.
/// e.g. `tauri://localhost/app/index.html` → `tauri://localhost/index.html`
fn rewrite_uri(uri: &str) -> String {
    for prefix in &[
        "tauri://localhost/app/",
        "tauri://localhost/app",
        "https://tauri.localhost/app/",
        "https://tauri.localhost/app",
    ] {
        if let Some(rest) = uri.strip_prefix(prefix) {
            let origin = prefix
                .trim_end_matches("/app/")
                .trim_end_matches("/app");
            return format!("{}/{}", origin, rest);
        }
    }
    uri.to_string()
}

/// Build the protocol handler that wraps the built-in `tauri://` protocol.
///
/// The upstream handler is called for all requests where `BundleRoot` is not set.
/// When `BundleRoot` is set (after an OTA update), files are served from disk instead.
pub fn get<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    window_origin: &str,
) -> tauri::webview::UriSchemeProtocolHandler {
    let upstream = tauri::protocol::tauri::get(app_handle.clone(), window_origin, None);
    let origin = window_origin.to_string();

    Box::new(move |webview_id, request, responder| {
        let bundle_root = app_handle.try_state::<BundleRoot>();
        let has_bundle = bundle_root
            .as_ref()
            .and_then(|br| br.0.read().ok())
            .as_ref()
            .and_then(|guard| guard.as_ref())
            .is_some();

        if has_bundle {
            // Serve from the OTA bundle directory on disk
            let raw_path = request
                .uri()
                .to_string()
                .split(&['?', '#'][..])
                .next()
                .unwrap_or_default()
                .to_string();

            let path = raw_path
                .strip_prefix("tauri://localhost")
                .or_else(|| raw_path.strip_prefix("https://tauri.localhost"))
                .unwrap_or(&raw_path);

            let asset_path = strip_app_prefix(path);

            let guard = bundle_root.unwrap().0.read().unwrap();
            let root_dir = guard.as_ref().unwrap();
            let file_path = root_dir.join(asset_path);

            match std::fs::read(&file_path) {
                Ok(data) => {
                    let mime = mime_guess::from_path(&file_path)
                        .first_or_octet_stream()
                        .to_string();
                    responder.respond(
                        HttpResponse::builder()
                            .header(CONTENT_TYPE, &mime)
                            .header("Access-Control-Allow-Origin", &*origin)
                            .body(data)
                            .unwrap(),
                    );
                }
                Err(_) => {
                    responder.respond(
                        HttpResponse::builder()
                            .status(StatusCode::NOT_FOUND)
                            .header("Access-Control-Allow-Origin", &*origin)
                            .body(Vec::new())
                            .unwrap(),
                    );
                }
            }
        } else {
            // Strip /app/ prefix and delegate to upstream handler
            let uri = request.uri().to_string();
            let rewritten = rewrite_uri(&uri);

            if rewritten != uri {
                let (mut parts, body) = request.into_parts();
                parts.uri = rewritten.parse().unwrap_or(parts.uri);
                let request = http::Request::from_parts(parts, body);
                upstream(webview_id, request, responder);
            } else {
                upstream(webview_id, request, responder);
            }
        }
    })
}
