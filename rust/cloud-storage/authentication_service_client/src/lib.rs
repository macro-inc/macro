pub mod error;
pub mod google_access_token;
pub mod relocate_inbox_grant;
pub mod unlink;
pub mod users;

#[derive(Clone)]
pub struct AuthServiceClient {
    url: String,
    client: reqwest::Client,
}

pub static INTERNAL_AUTH_HEADER_KEY: &str = "x-internal-auth-key";

const REQUEST_TIMEOUT_SECONDS: u64 = 15;

impl AuthServiceClient {
    pub fn new(internal_auth_key: String, url: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(INTERNAL_AUTH_HEADER_KEY, internal_auth_key.parse().unwrap());

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
            .build()
            .unwrap();

        Self { url, client }
    }
}
