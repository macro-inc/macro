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

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap();

        Self { url, client }
    }
}
