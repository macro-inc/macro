use constants::MACRO_INTERNAL_AUTH_KEY_HEADER_KEY;

pub(crate) mod constants;
pub mod delete;
pub mod error;

#[derive(Clone)]
pub struct NotificationServiceClient {
    url: String,
    client: reqwest::Client,
}

impl NotificationServiceClient {
    pub fn new(internal_auth_key: String, url: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            MACRO_INTERNAL_AUTH_KEY_HEADER_KEY,
            internal_auth_key.parse().unwrap(),
        );

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap();

        Self { url, client }
    }
}
