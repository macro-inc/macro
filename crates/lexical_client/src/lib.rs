pub(crate) static INTERNAL_ACCESS_HEADER: &str = "x-internal-auth-key";
pub mod parse_markdown;
pub mod types;

#[allow(dead_code)]
#[derive(Clone)]
pub struct LexicalClient {
    url: String,
    client: reqwest::Client,
}

impl LexicalClient {
    pub fn new(internal_auth_key: String, url: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(INTERNAL_ACCESS_HEADER, internal_auth_key.parse().unwrap());

        let client = {
            let mut builder = reqwest::Client::builder().default_headers(headers);
            if is_local_https(&url) {
                builder = builder.danger_accept_invalid_certs(true);
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
