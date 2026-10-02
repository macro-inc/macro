//! Pasted links that turn out to be images, as Cursor's prompt images and as
//! ACP image frames.
//!
//! A prompt is text. A URL in that text does not say what it points at, so
//! the bytes are fetched and kept only when they are a raster image Cursor
//! accepts. The same bytes go to Cursor as `prompt.images` and into the
//! transcript as an ACP image content block.

#[cfg(test)]
mod test;

use agent_client_protocol::schema::v1::{ContentBlock, ImageContent};
use std::collections::HashSet;

/// How many images one prompt may carry. Cursor rejects more than this.
pub const MAX_PROMPT_IMAGES: usize = 5;

/// How many links one prompt will try. Most links are not images; the cap
/// stops a message full of URLs from fetching all of them.
const MAX_LINK_FETCHES: usize = 8;

/// Decoded image size Cursor accepts on `prompt.images`.
pub const MAX_IMAGE_BYTES: usize = 15 * 1024 * 1024;

/// One image to send as Cursor `prompt.images` data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CursorPromptImage {
    /// Standard base64, no `data:` prefix.
    pub data: String,
    /// `image/png`, `image/jpeg`, `image/gif`, or `image/webp`.
    pub mime_type: String,
    /// Where the bytes were fetched from, when they came from a link.
    pub source_url: Option<String>,
}

impl CursorPromptImage {
    /// The ACP image frame for this picture. `uri` is the source link when
    /// there is one, so a reader can show the image without keeping the bytes.
    #[must_use]
    pub fn to_content_block(&self) -> ContentBlock {
        let mut image = ImageContent::new(self.data.clone(), self.mime_type.clone());
        if let Some(url) = &self.source_url {
            image = image.uri(url.clone());
        }
        ContentBlock::Image(image)
    }
}

/// Raster types Cursor's prompt image field accepts.
#[must_use]
pub fn supported_mime(mime: &str) -> bool {
    matches!(
        media_type(mime),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    )
}

/// `image/jpg` and parameter suffixes become the type Cursor wants.
#[must_use]
pub fn canonical_mime(mime: &str) -> Option<&'static str> {
    match media_type(mime) {
        "image/png" => Some("image/png"),
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/gif" => Some("image/gif"),
        "image/webp" => Some("image/webp"),
        _ => None,
    }
}

/// The media type, without parameters (`image/png; charset=binary`).
fn media_type(mime: &str) -> &str {
    mime.split(';').next().unwrap_or(mime).trim()
}

/// A type worth reading the body for: a supported image, or no type at all.
#[must_use]
pub fn worth_fetching(mime: Option<&str>) -> bool {
    match mime.map(media_type) {
        None | Some("") | Some("application/octet-stream") | Some("binary/octet-stream") => true,
        Some(mime) => canonical_mime(mime).is_some(),
    }
}

/// Image type from a `Content-Type` header, else from the leading bytes.
#[must_use]
pub fn detect_mime(content_type: Option<&str>, bytes: &[u8]) -> Option<&'static str> {
    if let Some(mime) = content_type.and_then(canonical_mime) {
        return Some(mime);
    }
    if !content_type.is_none_or(|mime| worth_fetching(Some(mime))) {
        return None;
    }
    sniff(bytes)
}

fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

/// Links in `blocks` that might be images, in order, without duplicates.
///
/// A link that is already an ACP image is skipped: its bytes are taken from
/// the block, and fetching it again would attach the picture twice.
#[must_use]
pub fn linked_image_urls(blocks: &[ContentBlock]) -> Vec<String> {
    let mut seen = HashSet::new();
    for block in blocks {
        if let ContentBlock::Image(image) = block
            && let Some(uri) = &image.uri
        {
            seen.insert(uri.clone());
        }
    }
    let mut urls = Vec::new();
    for block in blocks {
        match block {
            ContentBlock::Text(text) => collect_urls(&text.text, &mut urls, &mut seen),
            ContentBlock::ResourceLink(link) if worth_fetching(link.mime_type.as_deref()) => {
                push_url(link.uri.trim(), &mut urls, &mut seen);
            }
            _ => {}
        }
        if urls.len() >= MAX_LINK_FETCHES {
            break;
        }
    }
    urls.truncate(MAX_LINK_FETCHES);
    urls
}

/// ACP image blocks already on the prompt, in order, within Cursor's cap.
#[must_use]
pub fn images_in_blocks(blocks: &[ContentBlock]) -> Vec<CursorPromptImage> {
    let mut images = Vec::new();
    for block in blocks {
        let ContentBlock::Image(image) = block else {
            continue;
        };
        let Some(mime_type) = canonical_mime(&image.mime_type) else {
            continue;
        };
        if image.data.is_empty() || estimated_bytes(&image.data) > MAX_IMAGE_BYTES {
            continue;
        }
        images.push(CursorPromptImage {
            data: image.data.clone(),
            mime_type: mime_type.to_owned(),
            source_url: image.uri.clone(),
        });
        if images.len() == MAX_PROMPT_IMAGES {
            break;
        }
    }
    images
}

/// Append fetched images that are not already image blocks, keeping the
/// prompt's own blocks first.
#[must_use]
pub fn with_fetched_images(
    mut blocks: Vec<ContentBlock>,
    fetched: &[CursorPromptImage],
) -> Vec<ContentBlock> {
    for image in fetched {
        blocks.push(image.to_content_block());
    }
    blocks
}

fn estimated_bytes(base64: &str) -> usize {
    base64.len().saturating_mul(3) / 4
}

fn collect_urls(text: &str, urls: &mut Vec<String>, seen: &mut HashSet<String>) {
    let mut rest = text;
    while urls.len() < MAX_LINK_FETCHES {
        let Some(start) = earliest_url(rest) else {
            break;
        };
        let tail = &rest[start..];
        let end = tail
            .find(|ch: char| ch.is_whitespace() || matches!(ch, '<' | '>' | '"' | '\'' | '`'))
            .unwrap_or(tail.len());
        let raw = trim_trailing(&tail[..end]);
        push_url(raw, urls, seen);
        rest = &tail[end..];
    }
}

/// Index of the first `http://` or `https://` in `text`.
fn earliest_url(text: &str) -> Option<usize> {
    match (text.find("https://"), text.find("http://")) {
        (Some(https), Some(http)) => Some(https.min(http)),
        (Some(https), None) => Some(https),
        (None, Some(http)) => Some(http),
        (None, None) => None,
    }
}

fn push_url(raw: &str, urls: &mut Vec<String>, seen: &mut HashSet<String>) {
    if urls.len() >= MAX_LINK_FETCHES || raw.len() < "http://a".len() {
        return;
    }
    if !raw.starts_with("http://") && !raw.starts_with("https://") {
        return;
    }
    if seen.insert(raw.to_owned()) {
        urls.push(raw.to_owned());
    }
}

fn trim_trailing(url: &str) -> &str {
    let mut url = url;
    loop {
        let Some(last) = url.chars().last() else {
            break;
        };
        let strip = match last {
            ',' | '.' | ';' | '!' | '?' | ':' => true,
            ')' => url.matches('(').count() < url.matches(')').count(),
            ']' => url.matches('[').count() < url.matches(']').count(),
            _ => false,
        };
        if !strip {
            break;
        }
        url = &url[..url.len() - last.len_utf8()];
    }
    url
}
