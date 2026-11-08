//! Route-switch facade and the retained lexical-service HTTP transport.
mod facade;
mod routing;
pub use facade::LexicalClient;
pub use routing::{
    LexicalClientConfig, NotYetPorted, RouteGroup, RouteMode, RouteModes, RouteModesError,
};
pub(crate) static INTERNAL_ACCESS_HEADER: &str = "x-internal-auth-key";
pub mod notion;
pub mod parse_markdown;
pub mod types;

#[derive(Clone)]
pub(crate) struct HttpLexicalClient {
    url: String,
    client: reqwest::Client,
}

impl HttpLexicalClient {
    pub fn new(internal_auth_key: String, url: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(INTERNAL_ACCESS_HEADER, internal_auth_key.parse().unwrap());

        let client = {
            let mut builder = reqwest::Client::builder().default_headers(headers);
            if is_local_https(&url) {
                let ca = reqwest::Certificate::from_pem(include_bytes!(
                    "../../../infra/local/certs/ca.pem"
                ))
                .expect("checked-in local CA must be valid PEM");
                builder = builder.add_root_certificate(ca);
            }
            builder.build().unwrap()
        };

        Self { url, client }
    }
}

fn is_local_https(url: &str) -> bool {
    url.starts_with("https://localhost:")
        || url.starts_with("https://localhost/")
        || url == "https://localhost"
        || url.starts_with("https://127.0.0.1:")
        || url.starts_with("https://127.0.0.1/")
}

/// Carry the active caller/route span across the retained HTTP transport.
pub(crate) fn trace_headers() -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    macro_tower_layers::inject_trace_headers(&mut headers);
    headers
}
