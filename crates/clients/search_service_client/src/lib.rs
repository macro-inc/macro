use constants::INTERNAL_API_KEY_HEADER;
pub(crate) mod constants;
pub mod search_channel_name;
pub mod search_unified;

#[derive(Clone)]
pub struct SearchServiceClient {
    url: String,
    client: reqwest::Client,
}

impl SearchServiceClient {
    pub fn new(internal_auth_key: String, url: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(INTERNAL_API_KEY_HEADER, internal_auth_key.parse().unwrap());

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap();

        Self { url, client }
    }

    /// `request` carrying the current trace, so the search joins it.
    pub(crate) fn with_trace_headers(
        &self,
        request: reqwest::RequestBuilder,
    ) -> reqwest::RequestBuilder {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        request.headers(headers)
    }
}
