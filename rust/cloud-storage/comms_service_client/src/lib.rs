pub mod channels;
pub mod error;
pub mod messages;

#[derive(Clone)]
pub struct CommsServiceClient {
    url: String,
    client: reqwest::Client,
}

impl CommsServiceClient {
    pub fn new(url: String) -> Self {
        let client = reqwest::Client::builder().build().unwrap();

        Self { url, client }
    }

    /// Returns the base URL of the comms service
    pub fn url(&self) -> &str {
        &self.url
    }
}
