use crate::config::Config;
use reqwest::Client as RequestClient;
use reqwest::header::HeaderMap;
use secrecy::ExposeSecret;

pub struct Client {
    inner: RequestClient,
    config: Config,
}

impl Client {
    pub fn with_config(config: Config) -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-api-key",
            config
                .api_key
                .expose_secret()
                .parse()
                .expect("anthropic api key header"),
        );
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .expect("reqwest client");
        Self {
            config,
            inner: client,
        }
    }

    pub fn with_client(self, client: RequestClient) -> Self {
        Self {
            inner: client,
            ..self
        }
    }
}

// TODO
// impl Client {
//     pub fn message(&self) ->
// }
