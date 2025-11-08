use std::borrow::Cow;

use axum::http::{
    HeaderName, HeaderValue, Method,
    header::{AUTHORIZATION, CONTENT_TYPE},
};
use tower_http::cors::{AllowOrigin, CorsLayer};

static ALLOWED_ORIGINS: [&str; 11] = [
    "http://localhost:5173",
    "https://dashboarddev.macro.com",
    "https://dashboard.macro.com",
    "http://host.local:3000",
    "https://dev.macro.com",
    "https://staging.macro.com",
    "https://www.macro.com",
    "https://macro.com",
    "capacitor://localhost",
    "http://tauri.localhost",
    "https://apollo-testing.macro.com",
];

static EXTRA_HEADERS: [&str; 3] = ["x-permissions-token", "traceparent", "tracestate"];

fn get_allowed_origins() -> Vec<Cow<'static, str>> {
    match std::env::var("ALLOWED_ORIGINS") {
        Ok(origins) => origins
            .split(',')
            .map(|origin| origin.trim().to_string())
            .map(Cow::Owned)
            .collect(),
        Err(_) => ALLOWED_ORIGINS.into_iter().map(Cow::Borrowed).collect(),
    }
}

/// Generates the Cors layer which can be used in the `ServiceBuilder::layer` method.
pub fn cors_layer() -> CorsLayer {
    cors_layer_with_headers(vec![])
}

fn is_allowed_origin(origin: &str) -> bool {
    let allowed_origins = get_allowed_origins();
    // Check static origins first
    if allowed_origins.contains(&Cow::Borrowed(origin)) {
        return true;
    }

    // Check for localhost:3xxx pattern
    if origin.starts_with("http://localhost:3")
        && origin.len() == 21
        && let Some(port_str) = origin.strip_prefix("http://localhost:")
        && let Ok(port) = port_str.parse::<u16>()
    {
        return (3000..=3999).contains(&port);
    }

    false
}

/// Generates the Cors layer with additional headers which can be used in the `ServiceBuilder::layer` method.
pub fn cors_layer_with_headers(additional_headers: Vec<HeaderName>) -> CorsLayer {
    let mut headers = vec![AUTHORIZATION, CONTENT_TYPE];
    headers.extend(additional_headers);
    headers.extend(
        EXTRA_HEADERS
            .iter()
            .map(|header| HeaderName::from_static(header)),
    );

    CorsLayer::new()
        .allow_credentials(true)
        .allow_headers(headers)
        .allow_methods(vec![
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_origin(AllowOrigin::predicate(
            |origin: &HeaderValue, _request_parts| {
                origin.to_str().map(is_allowed_origin).unwrap_or(false)
            },
        ))
}
