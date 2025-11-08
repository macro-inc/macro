pub mod error;
pub mod get_names;
pub mod google_access_token;
pub mod unlink;

#[derive(Clone)]
pub struct AuthServiceClient {
    url: String,
    client: reqwest::Client,
}

pub static INTERNAL_AUTH_HEADER_KEY: &str = "x-internal-auth-key";

impl AuthServiceClient {
    pub fn new(internal_auth_key: String, url: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(INTERNAL_AUTH_HEADER_KEY, internal_auth_key.parse().unwrap());

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap();

        Self { url, client }
    }
}
