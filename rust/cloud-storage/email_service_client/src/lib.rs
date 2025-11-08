use constants::INTERNAL_AUTH_HEADER_KEY;

pub mod backfill;
pub(crate) mod constants;

mod external;
pub mod get_message_by_id;
pub mod get_messages_by_thread_id;
pub mod get_thread_histories;
pub mod get_thread_owner;

pub use external::*;

#[derive(Clone)]
pub struct EmailServiceClient {
    url: String,
    client: reqwest::Client,
}

impl EmailServiceClient {
    pub fn new(internal_auth_key: String, url: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(INTERNAL_AUTH_HEADER_KEY, internal_auth_key.parse().unwrap());

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap();

        Self { url, client }
    }

    pub fn url(&self) -> &str {
        &self.url
    }
}
