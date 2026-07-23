// Wrapper around the upstream Tauri protocol handler.
//
// Adds two behaviors on top of the built-in `tauri://` protocol:
// 1. Strips the `/app/` base path prefix before embedded asset resolution.
// 2. Resolves OTA assets through the bundle updater's domain service.

use http::{Response as HttpResponse, StatusCode, header::CONTENT_TYPE};
use macro_bundle_updater_plugin::domain::{
    asset_service::{
        BundleAssetPath, BundleAssetReadError, BundleAssetResolution, BundleAssetResolver,
        InvalidBundleAssetPath,
    },
    ports::BundleAssetRepo,
};
use std::time::Duration;
use tauri::{Runtime, UriSchemeResponder};

const ASSET_RESOLUTION_TIMEOUT: Duration = Duration::from_secs(30);

type ProtocolHandlerFn = dyn Fn(&str, http::Request<Vec<u8>>, UriSchemeResponder) + Send + Sync;
type ProtocolHandler = Box<ProtocolHandlerFn>;

#[derive(Debug, PartialEq, Eq)]
enum RequestPathError {
    InvalidEncoding,
    Unsafe(InvalidBundleAssetPath),
}

enum TimedAssetResolution {
    Resolved(Result<BundleAssetResolution, BundleAssetReadError>),
    TaskFailed(tauri::Error),
    TimedOut,
}

/// Strip the `/app` or `/app/` prefix used as the frontend base path.
/// Only strips when `/app` is a complete path segment (not e.g. `/app.css`).
fn strip_app_prefix(path: &str) -> &str {
    if let Some(rest) = path.strip_prefix("/app/") {
        return rest;
    }
    if path == "/app" {
        return "";
    }
    path
}

fn request_asset_path(uri: &http::Uri) -> Result<BundleAssetPath, RequestPathError> {
    let encoded = uri.path();
    let bytes = encoded.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let Some(hex) = bytes.get(index + 1..index + 3) else {
                return Err(RequestPathError::InvalidEncoding);
            };
            if !hex.iter().all(u8::is_ascii_hexdigit) {
                return Err(RequestPathError::InvalidEncoding);
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    let decoded = urlencoding::decode(encoded).map_err(|_| RequestPathError::InvalidEncoding)?;
    let path = strip_app_prefix(&decoded);
    let relative = path.strip_prefix('/').unwrap_or(path);
    BundleAssetPath::new(relative).map_err(RequestPathError::Unsafe)
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
            // Only match bare "/app" when rest is empty or starts with a
            // path separator — avoid rewriting "/app.css" etc.
            if !prefix.ends_with('/')
                && !rest.is_empty()
                && !rest.starts_with('/')
                && !rest.starts_with('?')
            {
                continue;
            }
            let origin = prefix.trim_end_matches("/app/").trim_end_matches("/app");
            return format!("{origin}/{rest}");
        }
    }
    uri.to_string()
}

fn respond_status(
    responder: UriSchemeResponder,
    status: StatusCode,
    origin: &str,
    message: impl Into<Vec<u8>>,
) {
    responder.respond(
        HttpResponse::builder()
            .status(status)
            .header(CONTENT_TYPE, "text/plain; charset=utf-8")
            .header("Access-Control-Allow-Origin", origin)
            .body(message.into())
            .expect("valid custom protocol response"),
    );
}

fn delegate_to_embedded(
    upstream: &ProtocolHandlerFn,
    webview_id: &str,
    request: http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let uri = request.uri().to_string();
    let rewritten = rewrite_uri(&uri);
    if rewritten == uri {
        upstream(webview_id, request, responder);
        return;
    }

    let (mut parts, body) = request.into_parts();
    if let Ok(uri) = rewritten.parse() {
        parts.uri = uri;
    }
    upstream(
        webview_id,
        http::Request::from_parts(parts, body),
        responder,
    );
}

async fn resolve_asset_with_timeout<Assets: BundleAssetRepo>(
    resolver: BundleAssetResolver<Assets>,
    asset_path: BundleAssetPath,
    timeout: Duration,
) -> TimedAssetResolution {
    // Keep resolution in an independently owned task. If the timeout elapses,
    // dropping its join handle detaches rather than cancels it, so its route
    // read lease remains held until any in-flight filesystem read completes.
    let resolution_task =
        tauri::async_runtime::spawn(async move { resolver.resolve(&asset_path).await });
    match tokio::time::timeout(timeout, resolution_task).await {
        Ok(Ok(resolution)) => TimedAssetResolution::Resolved(resolution),
        Ok(Err(error)) => TimedAssetResolution::TaskFailed(error),
        Err(_) => TimedAssetResolution::TimedOut,
    }
}

async fn resolve_request<Assets: BundleAssetRepo>(
    resolver: BundleAssetResolver<Assets>,
    upstream: &ProtocolHandlerFn,
    webview_id: String,
    request: http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
    origin: String,
) {
    let asset_path = match request_asset_path(request.uri()) {
        Ok(path) => path,
        Err(RequestPathError::InvalidEncoding) => {
            respond_status(
                responder,
                StatusCode::BAD_REQUEST,
                &origin,
                "invalid percent encoding in asset path",
            );
            return;
        }
        Err(RequestPathError::Unsafe(_)) => {
            respond_status(
                responder,
                StatusCode::FORBIDDEN,
                &origin,
                "asset path escaped bundle root",
            );
            return;
        }
    };

    let resolution = match resolve_asset_with_timeout(
        resolver,
        asset_path.clone(),
        ASSET_RESOLUTION_TIMEOUT,
    )
    .await
    {
        TimedAssetResolution::Resolved(Ok(resolution)) => resolution,
        TimedAssetResolution::Resolved(Err(BundleAssetReadError::OutsideBundleRoot)) => {
            respond_status(
                responder,
                StatusCode::FORBIDDEN,
                &origin,
                "resolved asset escaped bundle root",
            );
            return;
        }
        TimedAssetResolution::Resolved(Err(BundleAssetReadError::Io(error))) => {
            tracing::error!(error=?error, path=?asset_path.as_path(), "failed to read OTA asset");
            respond_status(
                responder,
                StatusCode::INTERNAL_SERVER_ERROR,
                &origin,
                "failed to read OTA asset",
            );
            return;
        }
        TimedAssetResolution::TaskFailed(error) => {
            tracing::error!(error=?error, path=?asset_path.as_path(), "bundle asset resolver task failed");
            respond_status(
                responder,
                StatusCode::INTERNAL_SERVER_ERROR,
                &origin,
                "failed to resolve bundle asset",
            );
            return;
        }
        TimedAssetResolution::TimedOut => {
            tracing::error!(path=?asset_path.as_path(), "timed out resolving bundle asset");
            respond_status(
                responder,
                StatusCode::GATEWAY_TIMEOUT,
                &origin,
                "timed out resolving bundle asset",
            );
            return;
        }
    };

    match resolution {
        BundleAssetResolution::Ota {
            bytes,
            content_path,
        } => {
            let mime = mime_guess::from_path(content_path.as_path())
                .first_or_octet_stream()
                .to_string();
            responder.respond(
                HttpResponse::builder()
                    .header(CONTENT_TYPE, mime)
                    .header("Access-Control-Allow-Origin", origin)
                    .body(bytes)
                    .expect("valid OTA asset response"),
            );
        }
        BundleAssetResolution::Embedded => {
            delegate_to_embedded(&*upstream, &webview_id, request, responder);
        }
        BundleAssetResolution::NotFound => {
            respond_status(
                responder,
                StatusCode::NOT_FOUND,
                &origin,
                "bundle asset not found",
            );
        }
    }
}

/// Build the asynchronous protocol handler that wraps Tauri's built-in handler.
pub fn get<R, Assets>(
    app_handle: tauri::AppHandle<R>,
    window_origin: &str,
    resolver: BundleAssetResolver<Assets>,
) -> ProtocolHandler
where
    R: Runtime,
    Assets: BundleAssetRepo,
{
    let upstream = &*Box::leak(tauri::protocol::tauri::get(app_handle, window_origin, None));

    let origin = window_origin.to_string();

    Box::new(move |webview_id, request, responder| {
        tauri::async_runtime::spawn(resolve_request(
            resolver.clone(),
            upstream,
            webview_id.to_owned(),
            request,
            responder,
            origin.clone(),
        ));
    })
}

#[cfg(test)]
mod test;
