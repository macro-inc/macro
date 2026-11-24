//! Fetching a stored version's bytes from the signed storage addresses APS
//! hands out. The address grants access by itself: no Autodesk credentials
//! go with the request.

use std::time::Duration;

use bytes::{Bytes, BytesMut};
use http::HeaderMap;
use tracing::Instrument;
use tracing::field::Empty;
use url::Url;

use crate::domain::models::SignedUrl;
use crate::domain::ports::{Download, DownloadError, SignedDownloads};

#[cfg(test)]
mod test;

/// The longest one download may take: 100 MiB on a slow link.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// How long reaching storage may take.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Downloads over HTTPS, never following a redirect, so an address can't
/// lead anywhere but where APS pointed.
pub struct HttpSignedDownloads {
    http: reqwest::Client,
    https_only: bool,
}

impl HttpSignedDownloads {
    /// A downloader that fetches only `https` addresses.
    pub fn new() -> Result<Self, reqwest::Error> {
        Self::build(true)
    }

    /// A downloader that also fetches plain `http`, for a local test double.
    #[cfg(test)]
    pub(crate) fn allowing_plain_http() -> Result<Self, reqwest::Error> {
        Self::build(false)
    }

    fn build(https_only: bool) -> Result<Self, reqwest::Error> {
        let http = reqwest::Client::builder()
            .timeout(DOWNLOAD_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self { http, https_only })
    }

    /// Append the part at `address` to `bytes`, stopping once they would pass
    /// `max_bytes`. Returns `false` when it stopped for the cap.
    async fn fetch_part(
        &self,
        address: &str,
        bytes: &mut BytesMut,
        max_bytes: u64,
    ) -> Result<bool, DownloadError> {
        let url = Url::parse(address).map_err(internal)?;
        if self.https_only && url.scheme() != "https" {
            return Err(DownloadError::Internal(rootcause::report!(
                "a signed download address is not https"
            )));
        }

        let mut headers = HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let mut response = self
            .http
            .get(url)
            .headers(headers)
            .send()
            .await
            .map_err(transport)?;
        let status = response.status();
        if !status.is_success() {
            return Err(DownloadError::Status(status.as_u16()));
        }

        let room = max_bytes.saturating_sub(len(bytes));
        if response
            .content_length()
            .is_some_and(|length| length > room)
        {
            return Ok(false);
        }
        // Read chunk by chunk, so a body larger than it claimed (or one with
        // no length) is cut off at the cap instead of being held whole.
        while let Some(chunk) = response.chunk().await.map_err(transport)? {
            if len(bytes).saturating_add(len(&chunk)) > max_bytes {
                return Ok(false);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(true)
    }
}

fn len(bytes: &[u8]) -> u64 {
    u64::try_from(bytes.len()).unwrap_or(u64::MAX)
}

/// A request failure, without the address: it is a credential.
fn transport(error: reqwest::Error) -> DownloadError {
    internal(error.without_url())
}

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> DownloadError {
    DownloadError::Internal(rootcause::Report::new(error).into_dynamic())
}

impl SignedDownloads for HttpSignedDownloads {
    async fn fetch(&self, url: &SignedUrl, max_bytes: u64) -> Result<Download, DownloadError> {
        let span = tracing::info_span!(
            "fusion.download",
            parts = url.parts.len(),
            bytes = Empty,
            outcome = Empty
        );
        async {
            let mut bytes = BytesMut::new();
            for part in &url.parts {
                if !self.fetch_part(part, &mut bytes, max_bytes).await? {
                    tracing::Span::current().record("outcome", "too_large");
                    return Ok(Download::TooLarge);
                }
            }
            tracing::Span::current().record("bytes", len(&bytes));
            tracing::Span::current().record("outcome", "fetched");
            Ok(Download::Bytes(Bytes::from(bytes)))
        }
        .instrument(span)
        .await
        .inspect_err(
            |error: &DownloadError| tracing::warn!(error = ?error, "signed download failed"),
        )
    }
}
