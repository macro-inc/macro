//! Favicon fetching through the existing SSRF-protected image client.

use futures::StreamExt;

pub(crate) mod remote_image;
mod resolver;

use crate::domain::{Logo, LogoDomain, LogoProvider};
use remote_image::{ProxyError, fetch_upstream};

const MAX_LOGO_SIZE: usize = 256 * 1024;

#[derive(Clone)]
pub struct FaviconProvider(pub reqwest::Client);

impl LogoProvider for FaviconProvider {
    type Error = ProxyError;

    #[tracing::instrument(skip_all, err)]
    async fn fetch(&self, domain: &LogoDomain) -> Result<Logo, Self::Error> {
        tokio::time::timeout(std::time::Duration::from_secs(10), self.fetch_icon(domain))
            .await
            .map_err(|_| ProxyError::UpstreamTimeout("logo request deadline exceeded".into()))?
    }
}

impl FaviconProvider {
    async fn fetch_icon(&self, domain: &LogoDomain) -> Result<Logo, ProxyError> {
        let url = url::Url::parse(&format!("https://{}/favicon.ico", domain.as_str()))
            .map_err(|error| ProxyError::InvalidUrl(error.to_string()))?;
        let (response, content_type) = fetch_upstream(&self.0, url, true).await?;
        let media_type = content_type.split(';').next().unwrap_or_default().trim();
        if !matches!(
            media_type,
            "image/png"
                | "image/jpeg"
                | "image/gif"
                | "image/webp"
                | "image/x-icon"
                | "image/vnd.microsoft.icon"
        ) {
            return Err(ProxyError::NotAnImage(content_type));
        }
        let mut stream = response.bytes_stream();
        let mut bytes = bytes::BytesMut::new();
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|_| ProxyError::UpstreamNetwork("logo body read failed".into()))?;
            if bytes.len() + chunk.len() > MAX_LOGO_SIZE {
                return Err(ProxyError::ImageTooLarge {
                    content_length: (bytes.len() + chunk.len()) as u64,
                });
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(Logo {
            bytes: bytes.freeze(),
            content_type,
        })
    }
}
