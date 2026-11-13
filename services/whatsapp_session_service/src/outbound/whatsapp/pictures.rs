//! Profile pictures over the account's connection: one `w:profile:picture`
//! query for the preview, then a plain HTTPS download of the image, since
//! WhatsApp's picture URLs expire.

use std::time::Duration;

use tracing::Instrument;
use whatsapp_linked::domain::events::{PictureAnswer, PictureCheck};
use whatsapp_linked::domain::models::{PICTURE_LIMIT_BYTES, PICTURE_MIME_LIMIT_BYTES};
use whatsmeow::types::Jid;
use whatsmeow::user::GetProfilePictureParams;
use whatsmeow::{Client, ClientError};

/// Longest a picture download may take.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30);

/// The one client every account's picture downloads share.
pub(super) fn http_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder().timeout(DOWNLOAD_TIMEOUT).build()
}

/// Asks for the picture and downloads a new one. Never errors: every failure
/// is an answer the domain schedules a retry for.
pub(super) async fn profile_picture(
    client: &Client,
    http: &reqwest::Client,
    check: &PictureCheck,
) -> PictureAnswer {
    let Ok(target) = check.jid.parse::<Jid>() else {
        return PictureAnswer::Failed;
    };
    let common_gid = match check.common_group.as_deref().map(str::parse::<Jid>) {
        Some(Ok(group)) => group,
        _ => Jid::default(),
    };
    let params = GetProfilePictureParams {
        preview: true,
        existing_id: check.existing_id.clone().unwrap_or_default(),
        common_gid,
        ..GetProfilePictureParams::default()
    };
    let info = match client.get_profile_picture_info(&target, &params).await {
        Ok(None) => return PictureAnswer::Unchanged,
        Ok(Some(info)) => info,
        Err(error) if error.is(&ClientError::ProfilePictureUnauthorized) => {
            return PictureAnswer::Hidden;
        }
        Err(error) if error.is(&ClientError::ProfilePictureNotSet) => {
            return PictureAnswer::NotSet;
        }
        Err(error) if error.is_iq_code(429) => return PictureAnswer::RateLimited,
        Err(error) => {
            tracing::warn!(error = %error, "Querying a WhatsApp profile picture failed");
            return PictureAnswer::Failed;
        }
    };
    let span = tracing::info_span!(
        "whatsapp.picture.download",
        bytes = tracing::field::Empty,
        outcome = tracing::field::Empty,
    );
    let downloaded = download(http, &info.url).instrument(span.clone()).await;
    match downloaded {
        Ok((bytes, mime)) => {
            span.record("bytes", bytes.len());
            span.record("outcome", "downloaded");
            PictureAnswer::Picture {
                id: info.id,
                bytes,
                mime,
            }
        }
        Err(failure) => {
            span.record("outcome", failure.as_str());
            match failure {
                // The picture host throttling the account is WhatsApp's
                // rate limit too: pause like a 429 on the query.
                DownloadFailure::RateLimited => PictureAnswer::RateLimited,
                DownloadFailure::Timeout
                | DownloadFailure::HttpError
                | DownloadFailure::NotAnImage
                | DownloadFailure::TooLarge => PictureAnswer::Failed,
            }
        }
    }
}

/// Why a picture download was refused, as `whatsapp.picture.download`
/// records it.
#[derive(Debug, Clone, Copy)]
enum DownloadFailure {
    RateLimited,
    Timeout,
    HttpError,
    NotAnImage,
    TooLarge,
}

impl DownloadFailure {
    fn as_str(self) -> &'static str {
        match self {
            DownloadFailure::RateLimited => "rate_limited",
            DownloadFailure::Timeout => "timeout",
            DownloadFailure::HttpError => "http_error",
            DownloadFailure::NotAnImage => "not_an_image",
            DownloadFailure::TooLarge => "too_large",
        }
    }
}

impl From<reqwest::Error> for DownloadFailure {
    fn from(error: reqwest::Error) -> Self {
        if error.status() == Some(reqwest::StatusCode::TOO_MANY_REQUESTS) {
            DownloadFailure::RateLimited
        } else if error.is_timeout() {
            DownloadFailure::Timeout
        } else {
            DownloadFailure::HttpError
        }
    }
}

/// The image and its type.
async fn download(http: &reqwest::Client, url: &str) -> Result<(Vec<u8>, String), DownloadFailure> {
    let mut response = http
        .get(url)
        .send()
        .await
        .and_then(|response| response.error_for_status())?;
    let mime = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|mime| mime.starts_with("image/") && mime.len() <= PICTURE_MIME_LIMIT_BYTES)
        .ok_or(DownloadFailure::NotAnImage)?
        .to_owned();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > PICTURE_LIMIT_BYTES {
            return Err(DownloadFailure::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((bytes, mime))
}
