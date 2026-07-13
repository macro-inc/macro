use axum::http::HeaderValue;

pub const ORIGINS: [HeaderValue; 23] = [
    HeaderValue::from_static("http://localhost:3000"),
    HeaderValue::from_static("http://localhost:3001"),
    HeaderValue::from_static("http://localhost:3002"),
    HeaderValue::from_static("http://localhost:3003"),
    HeaderValue::from_static("http://localhost:3004"),
    HeaderValue::from_static("http://localhost:3005"),
    HeaderValue::from_static("http://localhost:3006"),
    HeaderValue::from_static("http://localhost:3007"),
    HeaderValue::from_static("http://localhost:3008"),
    HeaderValue::from_static("http://localhost:3009"),
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
