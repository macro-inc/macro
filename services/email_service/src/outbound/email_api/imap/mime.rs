//! Normalize RFC 5322 mail without provider-specific HTTP payload assumptions.

use chrono::{TimeZone, Utc};
use email_api_client::domain::models::{CalendarPart, EmailApiError, MessageWithCalendarParts};
use mailparse::{MailAddr, MailHeaderMap, ParsedMail};
use models_email::service::{address::ContactInfo, attachment::Attachment, message::Message};
use uuid::Uuid;

use super::models;

pub(super) fn parse(
    link: Uuid,
    source: &models::Message,
    bytes: &[u8],
) -> Result<MessageWithCalendarParts, EmailApiError> {
    let mail = mailparse::parse_mail(bytes).map_err(|_| invalid_mime())?;
    let mut text = None;
    let mut html = None;
    let mut attachments = Vec::new();
    let mut calendar_parts = Vec::new();
    let mut stack = vec![(&mail, "0".to_owned(), 0_u8)];
    while let Some((part, path, depth)) = stack.pop() {
        if depth > 32 {
            return Err(invalid_mime());
        }
        let disposition = part.get_content_disposition();
        let filename = disposition
            .params
            .get("filename")
            .or_else(|| part.ctype.params.get("name"))
            .cloned();
        let content_id = part.headers.get_first_value("Content-ID").map(|value| {
            value
                .trim()
                .trim_start_matches('<')
                .trim_end_matches('>')
                .to_owned()
        });
        let is_attachment =
            filename.is_some() || disposition.disposition == mailparse::DispositionType::Attachment;
        if part.ctype.mimetype.eq_ignore_ascii_case("text/calendar") {
            calendar_parts.push(CalendarPart {
                part_id: Some(path.clone()),
                filename: filename.clone(),
                mime_type: part.ctype.mimetype.clone(),
                inline_data: Some(part.get_body_raw().map_err(|_| invalid_mime())?),
                provider_attachment_id: None,
            });
        }
        if is_attachment
            || content_id.is_some()
            || part.ctype.mimetype.eq_ignore_ascii_case("message/rfc822")
        {
            attachments.push(Attachment {
                db_id: macro_uuid::generate_uuid_v7(),
                provider_id: Some(path.clone()),
                data_url: None,
                reference_url: None,
                filename,
                mime_type: Some(part.ctype.mimetype.clone()),
                size_bytes: Some(
                    i64::try_from(part.get_body_raw().map_err(|_| invalid_mime())?.len())
                        .map_err(|_| invalid_mime())?,
                ),
                content_id,
                sfs_id: None,
            });
            // An attached message's text and invitations belong to that message.
            if part.ctype.mimetype.eq_ignore_ascii_case("message/rfc822") {
                continue;
            }
        } else if part.ctype.mimetype.eq_ignore_ascii_case("text/plain") && text.is_none() {
            text = Some(part.get_body().map_err(|_| invalid_mime())?);
        } else if part.ctype.mimetype.eq_ignore_ascii_case("text/html") && html.is_none() {
            html = Some(email_utils::sanitize_email_html(
                &part.get_body().map_err(|_| invalid_mime())?,
            ));
        }
        for (index, child) in part.subparts.iter().enumerate().rev() {
            stack.push((
                child,
                if path == "0" {
                    (index + 1).to_string()
                } else {
                    format!("{path}.{}", index + 1)
                },
                depth + 1,
            ));
        }
    }
    let header = |name| mail.headers.get_first_value(name);
    let sent_at = header("Date")
        .and_then(|date| mailparse::dateparse(&date).ok())
        .and_then(|seconds| Utc.timestamp_opt(seconds, 0).single());
    let now = Utc::now();
    let headers = mail
        .headers
        .iter()
        .map(|header| serde_json::json!({"name":header.get_key(),"value":header.get_value()}))
        .collect::<Vec<_>>();
    let flags = |value: &str| {
        source
            .flags
            .iter()
            .any(|flag| flag.eq_ignore_ascii_case(value))
    };
    Ok(MessageWithCalendarParts {
        message: Message {
            db_id: macro_uuid::generate_uuid_v7(),
            provider_id: Some(source.id.clone()),
            thread_db_id: macro_uuid::generate_uuid_v7(),
            provider_thread_id: Some(source.thread_id.clone()),
            replying_to_id: None,
            global_id: header("Message-ID"),
            link_id: link,
            subject: header("Subject"),
            snippet: text.as_ref().map(|body| body.chars().take(300).collect()),
            provider_history_id: None,
            internal_date_ts: Some(source.received_at),
            sent_at: sent_at.or(Some(source.received_at)),
            size_estimate: Some(i64::try_from(bytes.len()).map_err(|_| invalid_mime())?),
            is_read: flags("\\Seen"),
            is_starred: flags("\\Flagged"),
            is_sent: source.is_sent,
            is_draft: flags("\\Draft"),
            scheduled_send_time: None,
            has_attachments: !attachments.is_empty(),
            from: addresses(&mail, "From").into_iter().next(),
            to: addresses(&mail, "To"),
            cc: addresses(&mail, "Cc"),
            bcc: addresses(&mail, "Bcc"),
            labels: Vec::new(),
            body_text: text,
            body_html_sanitized: html,
            body_macro: None,
            attachments,
            attachments_draft: Vec::new(),
            attachments_forwarded: Vec::new(),
            headers_json: Some(serde_json::Value::Array(headers)),
            created_at: now,
            updated_at: now,
        },
        calendar_parts,
    })
}

fn addresses(mail: &ParsedMail<'_>, name: &str) -> Vec<ContactInfo> {
    let Some(value) = mail.headers.get_first_value(name) else {
        return Vec::new();
    };
    let Ok(parsed) = mailparse::addrparse(&value) else {
        return Vec::new();
    };
    parsed
        .iter()
        .flat_map(|address| match address {
            MailAddr::Single(address) => vec![address],
            MailAddr::Group(group) => group.addrs.iter().collect(),
        })
        .map(|address| ContactInfo {
            email: address.addr.clone(),
            name: address.display_name.clone(),
            photo_url: None,
        })
        .collect()
}

fn invalid_mime() -> EmailApiError {
    EmailApiError::Permanent {
        message: "IMAP message MIME is invalid or exceeds parsing limits".into(),
    }
}

#[cfg(test)]
mod test;
