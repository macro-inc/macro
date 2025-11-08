pub mod copy_document;
pub mod delete;
pub mod exists;
pub mod get_raw;
pub mod metadata;

pub(crate) static INTERNAL_ACCESS_HEADER: &str = "x-internal-auth-key";

#[allow(dead_code)]
#[derive(Clone)]
pub struct SyncServiceClient {
    url: String,
    client: reqwest::Client,
}

impl SyncServiceClient {
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
