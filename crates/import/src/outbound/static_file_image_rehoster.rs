//! Copies imported images into Macro's static file service, so pages keep
//! their images after the source's signed URLs expire.

use std::io::Cursor;
use std::time::Duration;

use anyhow::Context;
use static_file_service_client::StaticFileServiceClient;

use crate::domain::ports::{ImageRehoster, RehostError, RehostedImage};

#[cfg(test)]
mod test;

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30);
const FALLBACK_FILE_NAME: &str = "imported-image";

/// Downloads an image over HTTPS and stores it as a static file.
pub struct StaticFileImageRehoster {
    http: reqwest::Client,
    files: StaticFileServiceClient,
}

impl StaticFileImageRehoster {
    /// Store images through `files`.
    pub fn new(files: StaticFileServiceClient) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(DOWNLOAD_TIMEOUT)
            .build()
            .context("building image download client")?;
        Ok(Self { http, files })
    }
}

/// The file name to store: the URL's last path segment, without the
/// signed query string.
fn file_name(url: &str) -> String {
    url.split(['?', '#'])
        .next()
        .and_then(|path| path.rsplit('/').next())
        .map(str::trim)
        .filter(|name| !name.is_empty() && name.contains('.'))
        .unwrap_or(FALLBACK_FILE_NAME)
        .to_string()
}

/// Natural pixel size, read from the image header; `(0, 0)` when unknown.
fn dimensions(bytes: &[u8]) -> (u32, u32) {
    image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()
        .and_then(|reader| reader.into_dimensions().ok())
        .unwrap_or((0, 0))
}

impl ImageRehoster for StaticFileImageRehoster {
    #[tracing::instrument(skip(self, url), err)]
    async fn rehost(&self, url: &str, limit_bytes: usize) -> Result<RehostedImage, RehostError> {
        let mut response = self
            .http
            .get(url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .context("downloading image")?;
        if response
            .content_length()
            .is_some_and(|length| length as usize > limit_bytes)
        {
            return Err(RehostError::TooLarge { limit_bytes });
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.split(';').next().unwrap_or(value).trim().to_string())
            .unwrap_or_default();
        if !content_type.starts_with("image/") {
            return Err(RehostError::NotAnImage);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.context("reading image")? {
            if bytes.len() + chunk.len() > limit_bytes {
                return Err(RehostError::TooLarge { limit_bytes });
            }
            bytes.extend_from_slice(&chunk);
        }
        let (width, height) = dimensions(&bytes);
        let stored = self
            .files
            .put_named_bytes(&file_name(url), bytes.into(), &content_type)
            .await
            .context("storing image")?;
        Ok(RehostedImage {
            id: stored.id,
            url: stored.file_location,
            width,
            height,
        })
    }
}
