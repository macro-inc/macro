use chrono::{TimeZone, Utc};
use mailparse::{MailAddr, MailAddrList, addrparse};
use models_email::email::service;
use models_email::gmail::{Header, MessageResource};
use uuid::Uuid;

use super::payload::parse_gmail_payload;
use crate::domain::models::EmailApiError;

pub(crate) fn map_message_resource_to_service(
    message: MessageResource,
    link_id: Uuid,
) -> Result<service::message::Message, EmailApiError> {
    let parsed = parse_gmail_payload(&message.payload, &message.id)?;
    let internal_date_ts = message
        .internal_date
        .parse::<i64>()
        .ok()
        .and_then(|milliseconds| Utc.timestamp_millis_opt(milliseconds).single());
    let has_label = |label: &str| message.label_ids.iter().any(|id| id == label);
    let is_read = !has_label(service::label::system_labels::UNREAD);
    let is_starred = has_label(service::label::system_labels::STARRED);
    let is_sent = has_label(service::label::system_labels::SENT);
    let is_draft = has_label(service::label::system_labels::DRAFT);
    let labels = message
        .label_ids
        .iter()
        .map(|id| service::label::Label {
            id: None,
            link_id,
            provider_label_id: id.clone(),
            name: None,
            created_at: Default::default(),
            message_list_visibility: None,
            label_list_visibility: None,
            type_: None,
        })
        .collect();
    let attachments = parsed
        .attachments_metadata
        .into_iter()
        .map(|metadata| service::attachment::Attachment {
            db_id: Uuid::now_v7(),
            provider_id: metadata.provider_attachment_id,
            data_url: None,
            filename: metadata.filename,
            mime_type: metadata.mime_type,
            size_bytes: metadata.size_bytes,
            content_id: metadata.content_id,
            sfs_id: None,
        })
        .collect();
    let headers_json =
        serde_json::to_value(parsed.all_headers).map_err(|error| EmailApiError::Permanent {
            message: format!("failed to encode Gmail message headers: {error}"),
        })?;

    Ok(service::message::Message {
        db_id: Uuid::now_v7(),
        provider_id: Some(message.id),
        thread_db_id: Uuid::now_v7(),
        provider_thread_id: Some(message.thread_id),
        replying_to_id: None,
        global_id: Some(parsed.global_id),
        link_id,
        subject: parsed.subject,
        snippet: Some(message.snippet),
        provider_history_id: Some(message.history_id),
        internal_date_ts,
        sent_at: parsed.sent_at.or(internal_date_ts),
        size_estimate: Some(message.size_estimate as i64),
        is_read,
        is_starred,
        is_sent,
        is_draft,
        scheduled_send_time: None,
        has_attachments: parsed.has_attachments,
        from: parsed.from,
        to: parsed.to,
        cc: parsed.cc,
        bcc: parsed.bcc,
        labels,
        body_text: parsed.body_text,
        body_html_sanitized: parsed.body_html_sanitized,
        body_macro: None,
        attachments,
        attachments_draft: Vec::new(),
        attachments_forwarded: Vec::new(),
        headers_json: Some(headers_json),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

pub(super) fn parse_address_header(header_value: &str) -> Vec<(Option<String>, String)> {
    match addrparse(header_value) {
        Ok(addresses) => process_parsed_addresses(&addresses),
        Err(error) if header_value.contains(">,") => {
            let Some(index) = header_value.rfind(">,") else {
                return Vec::new();
            };
            addrparse(&header_value[..=index])
                .map(|addresses| process_parsed_addresses(&addresses))
                .unwrap_or_else(|salvage_error| {
                    // From/To information is silently lost past this point, so
                    // leave a trace. The raw header stays out of the log (PII).
                    tracing::warn!(
                        error = %salvage_error,
                        original_error = %error,
                        header_len = header_value.len(),
                        "address header failed to parse even after truncation salvage"
                    );
                    Vec::new()
                })
        }
        Err(error) => {
            tracing::warn!(
                error = %error,
                header_len = header_value.len(),
                "address header failed to parse; sender/recipient will be missing"
            );
            Vec::new()
        }
    }
}

fn process_parsed_addresses(addresses: &MailAddrList) -> Vec<(Option<String>, String)> {
    addresses
        .iter()
        .flat_map(|address| match address {
            MailAddr::Single(info) => vec![(info.display_name.clone(), info.addr.clone())],
            MailAddr::Group(group) => group
                .addrs
                .iter()
                .map(|info| (info.display_name.clone(), info.addr.clone()))
                .collect(),
        })
        .collect()
}

pub(super) fn find_header<'a>(headers: &'a [Header], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|header| header.name.eq_ignore_ascii_case(name))
        .map(|header| header.value.as_str())
}

#[cfg(test)]
mod test;
