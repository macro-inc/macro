use axum::http::HeaderValue;

pub const ORIGINS: [HeaderValue; 14] = [
    HeaderValue::from_static("http://localhost:3000"),
    HeaderValue::from_static("http://host.local:3000"),
    HeaderValue::from_static("https://app-dev.macro.com"),
    HeaderValue::from_static("https://app-staging.macro.com"),
    HeaderValue::from_static("https://app-prod.macro.com"),
    HeaderValue::from_static("https://app.macro.com"),
    HeaderValue::from_static("https://website-dev.macro.com"),
    HeaderValue::from_static("https://website-staging.macro.com"),
    HeaderValue::from_static("https://website-prod.macro.com"),
    HeaderValue::from_static("https://dev.macro.com"),
    HeaderValue::from_static("https://staging.macro.com"),
    HeaderValue::from_static("https://prod.macro.com"),
    HeaderValue::from_static("https://www.macro.com"),
    HeaderValue::from_static("https://macro.com"),
];

/// The default timeout threshold is 1 minute
pub const DEFAULT_TIMEOUT_THRESHOLD: u64 = 60_000;
