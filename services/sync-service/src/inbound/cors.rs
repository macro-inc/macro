use worker::Cors;

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
pub fn cors(request_origin: Option<&str>) -> Cors {
    use worker::Method;
    let cors_origins = request_origin
        .map(|o| {
            if is_origin_allowed(o) {
                vec![o.to_string()]
            } else {
                vec![]
            }
        })
        .unwrap_or_default();

    Cors::new()
        .with_credentials(true)
        // `traceparent`/`tracestate` are injected by the web client's traced
        // fetch wrapper (see `safeFetch`), so they must be preflight-allowed or
        // the browser blocks every instrumented call. Kept in sync with
        // `macro_cors::EXTRA_HEADERS`, which the axum services use; this worker
        // can't share that list because it's built on tower-http.
        .with_allowed_headers(vec![
            "authorization",
            "content-type",
            "traceparent",
            "tracestate",
        ])
        .with_methods(vec![
            Method::Get,
            Method::Post,
            Method::Put,
            Method::Patch,
            Method::Delete,
            Method::Options,
        ])
        .with_origins(cors_origins)
}
