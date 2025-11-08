use constants::MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY;

pub(crate) mod constants;
pub mod delete;
pub mod document;
pub mod error;
pub mod item_ids;
pub mod notification;
pub mod thread;
pub mod update_channel_share_permission;
pub mod update_user_channel_permissions;
pub mod upload;

#[derive(Clone)]
pub struct DocumentStorageServiceClient {
    internal_auth_key: String,
    url: String,
    client: reqwest::Client,
    external_client: reqwest::Client,
}

impl DocumentStorageServiceClient {
    pub fn new(internal_auth_key: String, url: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY,
            internal_auth_key.parse().unwrap(),
        );

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap();

        // Create a separate client for external API calls (without default auth headers)
        let external_client = reqwest::Client::new();

        Self {
            internal_auth_key,
            url,
            client,
            external_client,
        }
    }

    /// Creates a new request builder with JWT authentication instead of internal auth
    pub(crate) fn external_request(
        &self,
        method: reqwest::Method,
        path: &str,
        jwt_token: &str,
    ) -> reqwest::RequestBuilder {
        // Use the dedicated external client (without default internal auth headers)
        self.external_client
            .request(method, format!("{}{}", self.url, path))
            .header("Authorization", format!("Bearer {}", jwt_token))
    }
}
