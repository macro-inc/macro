use axum::http::{
    HeaderName, Method,
    header::{AUTHORIZATION, CONTENT_TYPE},
};
use tower_http::cors::{AllowOrigin, CorsLayer};

pub static ALLOWED_ORIGINS: &[&str] = &[
    "http://localhost:5173",
    "http://localhost:3000",
    "http://host.local:3000",
    "https://dev.macro.com",
    "https://staging.macro.com",
    "https://www.macro.com",
    "https://macro.com",
    "capacitor://localhost",
    "https://apollo-testing.macro.com",
];

pub fn is_origin_allowed(origin: &str) -> bool {
    if ALLOWED_ORIGINS.contains(&origin) {
        return true;
    }
    // `localhost` and `*.localhost` (loopback-reserved; local dev uses
    // per-persona hostnames so each seeded user gets its own cookie jar).
    if let Some(rest) = origin.strip_prefix("http://")
        && let Some((host, port)) = rest.rsplit_once(':')
        && (host == "localhost" || host.ends_with(".localhost"))
        && let Ok(port) = port.parse::<u16>()
    {
        return (3000..=3999).contains(&port) || (20000..=60000).contains(&port);
    }
    // Allow feature branch previews: https://{subdomain}.preview.macro.com
    if let Some(host) = origin.strip_prefix("https://")
        && let Some(subdomain) = host.strip_suffix(".preview.macro.com")
    {
        return !subdomain.is_empty() && !subdomain.contains('/');
    }
    false
}

/// Workaround for this bug: <https://github.com/cloudflare/workers-rs/issues/554>
/// CORS layer mirroring the previous manual config: credentials allowed, the
/// request origin reflected only when [`is_origin_allowed`], and the same
/// allowed methods/headers. Preflight (`OPTIONS`) is handled by the layer.
pub fn cors_layer() -> tower_http::cors::CorsLayer {
    CorsLayer::new()
        .allow_credentials(true)
        // `traceparent`/`tracestate` are injected by the web client's traced
        // fetch wrapper (see `safeFetch`), so they must be preflight-allowed or
        // the browser blocks every instrumented call. Kept in sync with
        // `macro_cors::EXTRA_HEADERS`.
        .allow_headers([
            AUTHORIZATION,
            CONTENT_TYPE,
            HeaderName::from_static("traceparent"),
            HeaderName::from_static("tracestate"),
        ])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_origin(AllowOrigin::predicate(|origin, _parts| {
            origin.to_str().map(is_origin_allowed).unwrap_or(false)
        }))
}
