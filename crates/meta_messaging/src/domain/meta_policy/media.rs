//! Meta implementation limits and transport validation.

use crate::domain::{
    events::MediaKind,
    media::{MAX_FILE_BYTES, MediaCapability},
    models::{MessagingError, Provider},
};

/// Sending matrix verified for the pinned Graph version; inbound unsupported
/// formats remain visible and can be opened in the original provider application.
pub fn capabilities(provider: Provider) -> Vec<MediaCapability> {
    use MediaKind::*;
    [Image, Audio, Video, Document]
        .into_iter()
        .map(|kind| {
            let (mime_types, max): (&[&str], usize) = match (provider, kind) {
                (Provider::Whatsapp, Image) => (&["image/jpeg", "image/png"], 5 * 1024 * 1024),
                (Provider::Whatsapp, Audio) => (
                    &["audio/aac", "audio/mp4", "audio/mpeg", "audio/ogg"],
                    16 * 1024 * 1024,
                ),
                (Provider::Whatsapp, Video) => (&["video/mp4"], 16 * 1024 * 1024),
                (Provider::Whatsapp, Document) => {
                    (&["application/pdf", "text/plain"], MAX_FILE_BYTES)
                }
                (Provider::Instagram, Image) => (&["image/jpeg", "image/png"], 8 * 1024 * 1024),
                (Provider::Instagram, Audio) => {
                    (&["audio/aac", "audio/mp4", "audio/wav"], 25 * 1024 * 1024)
                }
                (Provider::Instagram, Video) => (
                    &["video/mp4", "video/quicktime", "video/webm"],
                    25 * 1024 * 1024,
                ),
                (Provider::Instagram, Document) => (&["application/pdf"], 25 * 1024 * 1024),
            };
            MediaCapability {
                kind,
                mime_types: mime_types.iter().map(|s| (*s).into()).collect(),
                max_bytes: max as u32,
                caption_limit: (provider == Provider::Whatsapp && kind != Audio).then_some(1024),
            }
        })
        .collect()
}

/// Server-side media validation, including an attempted API/composer bypass.
pub fn validate(
    provider: Provider,
    kind: MediaKind,
    mime: &str,
    bytes: usize,
    caption: Option<&str>,
) -> Result<(), MessagingError> {
    let capability = capabilities(provider)
        .into_iter()
        .find(|c| c.kind == kind)
        .expect("closed media categories");
    if bytes == 0
        || bytes > capability.max_bytes as usize
        || !capability.mime_types.iter().any(|m| m == mime)
    {
        return Err(MessagingError::Invalid(
            "attachment type or size is unsupported for this provider",
        ));
    }
    if let Some(text) = caption.filter(|s| !s.is_empty()) {
        let limit = capability.caption_limit.ok_or(MessagingError::Invalid(
            "send this attachment's caption as a separate text reply",
        ))?;
        if text.chars().count() > usize::from(limit) {
            return Err(MessagingError::Invalid("attachment caption is too long"));
        }
    }
    Ok(())
}
