use base64::{
    Engine as _,
    engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD},
};
use chrono::{DateTime, TimeZone, Utc};
use models_email::email::service;
use models_email::gmail::{Header, MessagePart};

use super::message::{find_header, parse_address_header};
use crate::domain::models::EmailApiError;
use email_utils::sanitize_email_html;

#[derive(Debug, Default)]
pub(super) struct ParsedGmailPayload {
    pub(super) global_id: String,
    pub(super) from: Option<service::address::ContactInfo>,
    pub(super) to: Vec<service::address::ContactInfo>,
    pub(super) cc: Vec<service::address::ContactInfo>,
    pub(super) bcc: Vec<service::address::ContactInfo>,
    pub(super) subject: Option<String>,
    pub(super) sent_at: Option<DateTime<Utc>>,
    pub(super) body_text: Option<String>,
    pub(super) body_html_sanitized: Option<String>,
    pub(super) attachments_metadata: Vec<AttachmentMetadata>,
    pub(super) has_attachments: bool,
    pub(super) all_headers: Vec<Header>,
}

#[derive(Debug, Clone)]
pub(super) struct AttachmentMetadata {
    pub(super) provider_attachment_id: Option<String>,
    pub(super) filename: Option<String>,
    pub(super) mime_type: Option<String>,
    pub(super) size_bytes: Option<i64>,
    pub(super) content_id: Option<String>,
}

pub(super) fn parse_gmail_payload(
    message_payload: &MessagePart,
    message_id: &str,
) -> Result<ParsedGmailPayload, EmailApiError> {
    let all_headers = message_payload.headers.clone();
    let mut parsed = ParsedGmailPayload {
        global_id: find_header(&all_headers, "Message-ID")
            .unwrap_or_default()
            .to_owned(),
        subject: find_header(&all_headers, "Subject").map(str::to_owned),
        sent_at: find_header(&all_headers, "Date")
            .and_then(|date| mailparse::dateparse(date).ok())
            .and_then(|timestamp| Utc.timestamp_opt(timestamp, 0).single()),
        all_headers,
        ..Default::default()
    };

    if let Some(from) = find_header(&parsed.all_headers, "From")
        && let Some((name, email)) = parse_address_header(from).first()
    {
        parsed.from = Some(contact_info(name.clone(), email.clone()));
    }

    for (header_name, recipients) in [
        ("To", &mut parsed.to),
        ("Cc", &mut parsed.cc),
        ("Bcc", &mut parsed.bcc),
    ] {
        if let Some(value) = find_header(&parsed.all_headers, header_name) {
            recipients.extend(
                parse_address_header(value)
                    .into_iter()
                    .map(|(name, email)| contact_info(name, email)),
            );
        }
    }

    let mut part_stack = vec![message_payload];
    while let Some(part) = part_stack.pop() {
        parse_part(part, message_id, &mut parsed);
        if let Some(parts) = &part.parts {
            part_stack.extend(parts.iter().rev());
        }
    }

    Ok(parsed)
}

fn parse_part(part: &MessagePart, message_id: &str, parsed: &mut ParsedGmailPayload) {
    let mime_type = part.mime_type.to_lowercase();
    let is_multipart = mime_type.starts_with("multipart/alternative")
        || mime_type.starts_with("multipart/related")
        || mime_type.starts_with("multipart/mixed");
    let disposition = find_header(&part.headers, "Content-Disposition")
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .map(str::to_lowercase)
        .unwrap_or_default();
    let is_attachment = disposition == "attachment"
        || (disposition == "inline" && !mime_type.starts_with("text/"))
        || (!part.filename.is_empty() && !is_multipart && !mime_type.starts_with("text/"));

    let Some(body) = &part.body else {
        return;
    };

    if let Some(encoded) = &body.data_base64 {
        let wants_text = mime_type == "text/plain" && parsed.body_text.is_none();
        let wants_html = mime_type == "text/html" && parsed.body_html_sanitized.is_none();
        if wants_text || wants_html {
            // Gmail emits both padded and unpadded base64url in practice.
            match URL_SAFE_NO_PAD
                .decode(encoded)
                .or_else(|_| URL_SAFE.decode(encoded))
            {
                Ok(bytes) if wants_text => {
                    parsed.body_text = Some(decode_part_text(&bytes, part));
                }
                Ok(bytes) => {
                    parsed.body_html_sanitized =
                        Some(sanitize_email_html(&decode_part_text(&bytes, part)));
                }
                // A single undecodable part must not sink the message (or its
                // whole thread): keep the rest of the message and move on.
                Err(error) => {
                    tracing::warn!(
                        message_id = %message_id,
                        part_id = %part.part_id,
                        mime = %part.mime_type,
                        error = %error,
                        "failed to decode base64 body data"
                    );
                }
            }
        }
    }

    if is_attachment && body.attachment_id.is_some() {
        parsed.has_attachments = true;
        parsed.attachments_metadata.push(AttachmentMetadata {
            provider_attachment_id: body.attachment_id.clone(),
            filename: normalized_filename(&part.filename),
            mime_type: Some(part.mime_type.clone()),
            size_bytes: Some(body.size),
            content_id: find_header(&part.headers, "Content-ID").map(str::to_owned),
        });
    }
}

/// Decodes part bytes using UTF-8 when valid, otherwise honoring the part's
/// declared `charset`.
///
/// Some senders emit UTF-8 bytes while incorrectly declaring a legacy
/// single-byte charset. Trusting that declaration turns a bullet (`•`) into
/// mojibake (`â€¢`). Valid UTF-8 is therefore preferred over a conflicting
/// single-byte declaration. Multi-byte encodings still take precedence, and
/// unknown or missing charsets fall back to lossy UTF-8.
fn decode_part_text(bytes: &[u8], part: &MessagePart) -> String {
    let encoding = find_header(&part.headers, "Content-Type")
        .and_then(content_type_charset)
        .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()));

    match encoding {
        Some(encoding) if encoding.is_single_byte() => match str::from_utf8(bytes) {
            Ok(text) => text.to_owned(),
            Err(_) => encoding.decode(bytes).0.into_owned(),
        },
        Some(encoding) => encoding.decode(bytes).0.into_owned(),
        None => String::from_utf8_lossy(bytes).into_owned(),
    }
}

fn content_type_charset(content_type: &str) -> Option<&str> {
    content_type.split(';').skip(1).find_map(|parameter| {
        let (key, value) = parameter.split_once('=')?;
        key.trim()
            .eq_ignore_ascii_case("charset")
            .then(|| value.trim().trim_matches('"'))
    })
}

fn contact_info(name: Option<String>, email: String) -> service::address::ContactInfo {
    service::address::ContactInfo {
        email,
        name,
        photo_url: None,
    }
}

fn normalized_filename(filename: &str) -> Option<String> {
    if filename.is_empty() {
        return None;
    }

    Some(match filename.rsplit_once('.') {
        Some((base, extension)) if !extension.is_empty() => {
            format!("{base}.{}", extension.to_lowercase())
        }
        _ => filename.to_owned(),
    })
}

#[cfg(test)]
mod test;
