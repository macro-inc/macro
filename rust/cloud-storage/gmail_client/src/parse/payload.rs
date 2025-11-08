use anyhow::Result;
use base64::{Engine as _, engine::general_purpose::URL_SAFE};
use chrono::{DateTime, TimeZone, Utc};
use models_email::email::service;
use models_email::gmail::{Header, MessagePart};

use crate::parse::message::find_header;
use crate::parse::message::parse_address_header;
use crate::sanitizer::sanitize_email_html;

#[derive(Debug, Default)]
pub struct ParsedGmailPayload {
    pub global_id: String,
    pub from: Option<service::address::ContactInfo>,
    pub to: Vec<service::address::ContactInfo>,
    pub cc: Vec<service::address::ContactInfo>,
    pub bcc: Vec<service::address::ContactInfo>,
    pub subject: Option<String>,
    pub sent_at: Option<DateTime<Utc>>,
    pub body_text: Option<String>,
    pub body_html_sanitized: Option<String>,
    pub attachments_metadata: Vec<AttachmentMetadataIntermediate>,
    pub has_attachments: bool,
    pub all_headers: Vec<Header>,
}

#[derive(Debug, Clone)]
pub struct AttachmentMetadataIntermediate {
    pub provider_attachment_id: Option<String>,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub content_id: Option<String>,
}

#[tracing::instrument(skip(message_payload))]
pub fn parse_gmail_payload(
    message_payload: &MessagePart,
    message_id_for_log: &str,
) -> Result<ParsedGmailPayload> {
    let mut parsed = ParsedGmailPayload::default();
    parsed.all_headers = message_payload.headers.clone();

    // should always exist
    parsed.global_id = find_header(&parsed.all_headers, "Message-ID")
        .unwrap_or_default()
        .to_string();

    parsed.subject = find_header(&parsed.all_headers, "Subject").map(String::from);
    if let Some(date_str) = find_header(&parsed.all_headers, "Date")
        && let Ok(timestamp) = mailparse::dateparse(date_str)
    {
        parsed.sent_at = Utc.timestamp_opt(timestamp, 0).single();
        // we set the service message's sent_at value to internal_date_ts if we can't parse it
    }
    if let Some(from_str) = find_header(&parsed.all_headers, "From")
        && let Some((name, email)) = parse_address_header(from_str).first()
    {
        parsed.from = Some(service::address::ContactInfo {
            email: email.clone(),
            name: name.clone(),
            photo_url: None,
        });
    }
    for header_name in ["To", "Cc", "Bcc"].iter() {
        if let Some(header_str) = find_header(&parsed.all_headers, header_name) {
            let addresses = parse_address_header(header_str);
            let target_list = match *header_name {
                "To" => &mut parsed.to,
                "Cc" => &mut parsed.cc,
                "Bcc" => &mut parsed.bcc,
                _ => continue,
            };
            for (name, email) in addresses {
                target_list.push(service::address::ContactInfo {
                    email,
                    name,
                    photo_url: None,
                });
            }
        }
    }

    let mut text_body: Option<String> = None;
    let mut html_body: Option<String> = None;
    let mut attachments: Vec<AttachmentMetadataIntermediate> = Vec::new();
    let mut has_attachments_flag = false;
    let mut part_stack: Vec<&MessagePart> = vec![message_payload];

    while let Some(part) = part_stack.pop() {
        let mime_type = part.mime_type.to_lowercase();
        let is_alternative = mime_type.starts_with("multipart/alternative");
        let is_related = mime_type.starts_with("multipart/related");
        let is_mixed = mime_type.starts_with("multipart/mixed");
        let is_multipart = is_alternative || is_related || is_mixed;

        let disposition = find_header(&part.headers, "Content-Disposition")
            .map(|d| d.split(';').next().unwrap_or("").trim().to_lowercase())
            .unwrap_or_default();

        let is_inline_non_text = disposition == "inline" && !mime_type.starts_with("text/");
        let is_regular_attachment = disposition == "attachment"
            || (!part.filename.is_empty() && !is_multipart && !mime_type.starts_with("text/"));

        if let Some(body) = &part.body {
            // process plaintext/html data
            if let Some(data_b64) = &body.data_base64 {
                match URL_SAFE.decode(data_b64) {
                    Ok(decoded_bytes) => {
                        if mime_type == "text/plain" && text_body.is_none() {
                            text_body = Some(String::from_utf8_lossy(&decoded_bytes).to_string());
                        } else if mime_type == "text/html" && html_body.is_none() {
                            let raw_html = String::from_utf8_lossy(&decoded_bytes);
                            let sanitized_html = sanitize_email_html(&raw_html);
                            html_body = Some(sanitized_html);
                        }
                    }
                    Err(e) => {
                        tracing::warn!(message_id=%message_id_for_log, part_id=%part.part_id, mime=%part.mime_type, error=%e, "Failed to decode base64 body data")
                    }
                }
            }

            // process attachment data
            if (is_inline_non_text || is_regular_attachment) && body.attachment_id.is_some() {
                has_attachments_flag = true;
                let content_id = find_header(&part.headers, "Content-ID").map(String::from);

                attachments.push(AttachmentMetadataIntermediate {
                    provider_attachment_id: body.attachment_id.clone(),
                    filename: Some(part.filename.clone()).filter(|s| !s.is_empty()),
                    mime_type: Some(part.mime_type.clone()),
                    size_bytes: Some(body.size),
                    content_id,
                });
            }
        }

        if let Some(sub_parts) = &part.parts {
            for sub_part in sub_parts.iter().rev() {
                part_stack.push(sub_part);
            }
        }
    }

    parsed.body_text = text_body;
    parsed.body_html_sanitized = html_body;
    parsed.attachments_metadata = attachments;
    parsed.has_attachments = has_attachments_flag;

    Ok(parsed)
}
