//! Expiring media URLs are resolved on each attempt and copied into Macro.

use super::*;
use base64::Engine;
use sha2::{Digest, Sha256};

impl HttpMetaProvider {
    pub(super) async fn download_impl(
        &self,
        c: &Connection,
        token: &AccessToken,
        media: &IncomingMedia,
    ) -> PortResult<MediaBytes> {
        let (url, mime, hash) = match c.provider {
            Provider::Whatsapp => {
                let id = media.id.as_ref().ok_or(MessagingError::ProviderRejected)?;
                let descriptor = self
                    .graph(
                        c.provider,
                        token,
                        Method::GET,
                        &[id.as_str()],
                        &[("phone_number_id", c.account_id.as_str())],
                        None,
                    )
                    .await?;
                (
                    required(&descriptor, "url")?.to_owned(),
                    descriptor["mime_type"]
                        .as_str()
                        .map(str::to_owned)
                        .or_else(|| media.mime_type.clone()),
                    descriptor["sha256"]
                        .as_str()
                        .map(str::to_owned)
                        .or_else(|| media.sha256.clone()),
                )
            }
            Provider::Instagram => (
                media.url.clone().ok_or(MessagingError::ProviderRejected)?,
                media.mime_type.clone(),
                None,
            ),
        };
        let url = Url::parse(&url).map_err(|_| MessagingError::ProviderRejected)?;
        if !allowed_media_url(&url) {
            return Err(MessagingError::Invalid(
                "provider media URL is not on an approved Meta CDN",
            )
            .into());
        }
        let mut request = self.client.get(url);
        if c.provider == Provider::Whatsapp {
            request = request.bearer_auth(token.expose());
        }
        let response = request
            .send()
            .await
            .map_err(|_| MessagingError::Unavailable)?;
        if !response.status().is_success() {
            return Err(MessagingError::Unavailable.into());
        }
        let header_type = response
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .map(|s| s.split(';').next().unwrap_or(s).trim().to_owned());
        let mime = mime.or(header_type).ok_or(MessagingError::Invalid(
            "provider attachment has no media type",
        ))?;
        let bytes = bounded_bytes(response, 32 * 1024 * 1024).await?;
        if let Some(hash) = hash
            && !checksum_matches(&hash, &bytes)
        {
            return Err(MessagingError::Invalid("provider attachment checksum mismatch").into());
        }
        let extension = match mime.as_str() {
            "image/jpeg" => "jpg",
            "image/png" => "png",
            "image/webp" => "webp",
            "audio/mpeg" => "mp3",
            "audio/ogg" => "ogg",
            "audio/aac" => "aac",
            "audio/amr" => "amr",
            "audio/mp4" | "audio/x-m4a" => "m4a",
            "audio/wav" => "wav",
            "video/mp4" => "mp4",
            "video/quicktime" => "mov",
            "video/webm" => "webm",
            "application/pdf" => "pdf",
            "text/plain" => "txt",
            _ => "bin",
        };
        let filename = media_filename(media.filename.as_deref(), extension);
        Ok(MediaBytes {
            filename,
            mime_type: mime,
            bytes,
        })
    }
}

fn media_filename(filename: Option<&str>, extension: &str) -> String {
    filename
        .filter(|s| {
            !s.trim().is_empty()
                && s.len() <= 255
                && !s.contains(['/', '\\'])
                && !s.chars().any(char::is_control)
        })
        .map(str::to_owned)
        .unwrap_or_else(|| format!("attachment.{extension}"))
}

fn checksum_matches(expected: &str, bytes: &[u8]) -> bool {
    let digest = Sha256::digest(bytes);
    let hex = digest
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    expected.eq_ignore_ascii_case(&hex)
        || base64::engine::general_purpose::STANDARD
            .decode(expected)
            .is_ok_and(|bytes| bytes.as_slice() == &digest[..])
}

fn allowed_media_url(url: &Url) -> bool {
    if url.scheme() != "https"
        || url.port().is_some_and(|p| p != 443)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return false;
    }
    url.host_str().is_some_and(|h| {
        ["fbcdn.net", "fbsbx.com", "cdninstagram.com"]
            .iter()
            .any(|suffix| h == *suffix || h.ends_with(&format!(".{suffix}")))
    })
}

#[cfg(test)]
mod test;
