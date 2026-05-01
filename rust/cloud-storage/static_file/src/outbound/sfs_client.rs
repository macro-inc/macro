//! [`StaticFileRepo`] backed by a CDN base URL.

use crate::domain::ports::StaticFileRepo;

/// Fetches static files from `{base_url}/file/{file_id}`.
pub struct CdnStaticFileRepo {
    base_url: String,
    client: reqwest::Client,
}

impl CdnStaticFileRepo {
    /// Create a new repo pointing at the given CDN base URL.
    pub fn new(base_url: String) -> Self {
        Self {
            base_url,
            client: reqwest::Client::new(),
        }
    }

    fn url(&self, file_id: &str) -> String {
        format!("{}/file/{}", self.base_url, file_id)
    }
}

impl StaticFileRepo for CdnStaticFileRepo {
    async fn content_type(&self, file_id: &str) -> anyhow::Result<mime::Mime> {
        let response = self.client.head(self.url(file_id)).send().await?;

        if !response.status().is_success() {
            anyhow::bail!("static file HEAD failed: HTTP {}", response.status());
        }

        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse().ok())
            .unwrap_or(mime::APPLICATION_OCTET_STREAM);

        Ok(mime)
    }

    async fn read(&self, file_id: &str) -> anyhow::Result<Vec<u8>> {
        let response = self.client.get(self.url(file_id)).send().await?;

        if !response.status().is_success() {
            anyhow::bail!("static file GET failed: HTTP {}", response.status());
        }

        Ok(response.bytes().await?.to_vec())
    }
}
