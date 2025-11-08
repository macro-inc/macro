use constants::MACRO_INTERNAL_AUTH_KEY_HEADER_KEY;

pub mod channel_message;
pub mod channels;
pub(crate) mod constants;
pub mod create_welcome_message;
pub mod error;
pub mod mentions;
pub mod messages;
pub mod organization;
pub mod participants;
pub mod permissions;
pub mod user_channels;

#[derive(Clone)]
pub struct CommsServiceClient {
    url: String,
    client: reqwest::Client,
}

impl CommsServiceClient {
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
