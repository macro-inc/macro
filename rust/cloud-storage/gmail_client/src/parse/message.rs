use super::payload::parse_gmail_payload;
use anyhow::{Context, Result};
use chrono::{TimeZone, Utc};
use mailparse::{MailAddr, MailAddrList, addrparse};
use models_email::email::service;
use models_email::gmail::labels::SystemLabelID;
use models_email::gmail::{Header, MessageResource};
use uuid::Uuid;

#[tracing::instrument(skip(message), level = "debug")]
pub fn map_message_resource_to_service(
    message: MessageResource,
    link_id: Uuid,
) -> Result<service::message::Message> {
    let parsed_payload = parse_gmail_payload(&message.payload, &message.id)
        .context("Failed parsing message payload")?;

    let internal_date_ts = message
        .internal_date
        .parse::<i64>()
        .ok()
        .and_then(|ms| Utc.timestamp_millis_opt(ms).single());

    let is_read = !message
        .label_ids
        .iter()
        .any(|l| l == SystemLabelID::Unread.as_str());
    let is_starred = message
        .label_ids
        .iter()
        .any(|l| l == SystemLabelID::Starred.as_str());
    let is_sent = message
        .label_ids
        .iter()
        .any(|l| l == SystemLabelID::Sent.as_str());
    let is_draft = message
        .label_ids
        .iter()
        .any(|l| l == SystemLabelID::Draft.as_str());

    let labels: Vec<service::label::Label> = message
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

    let attachments = parsed_payload
        .attachments_metadata
        .into_iter()
        .map(|meta| {
            service::attachment::Attachment {
                db_id: None, // gets populated later
                provider_id: meta.provider_attachment_id,
                data_url: None,
                filename: meta.filename,
                mime_type: meta.mime_type,
                size_bytes: meta.size_bytes,
                content_id: meta.content_id,
            }
        })
        .collect();

    Ok(service::message::Message {
        db_id: None, // Omitted - needs to be associated later
        provider_id: Some(message.id),
        thread_db_id: None, // Omitted - needs to be associated later
        provider_thread_id: Some(message.thread_id),
        replying_to_id: None, // gets generated later, once message has been inserted
        global_id: Some(parsed_payload.global_id),
        link_id, // From argument
        subject: parsed_payload.subject,
        snippet: Some(message.snippet),
        provider_history_id: Some(message.history_id),
        internal_date_ts,
        sent_at: parsed_payload.sent_at.or(internal_date_ts),
        size_estimate: Some(message.size_estimate as i64),
        is_read,
        is_starred,
        is_sent,
        is_draft,
        scheduled_send_time: None,
        has_attachments: parsed_payload.has_attachments,
        from: parsed_payload.from,
        to: parsed_payload.to,
        cc: parsed_payload.cc,
        bcc: parsed_payload.bcc,
        labels,
        body_text: parsed_payload.body_text,
        body_html_sanitized: parsed_payload.body_html_sanitized,
        body_macro: None,
        attachments,
        attachments_macro: Vec::new(),
        headers_json: Some(serde_json::to_value(parsed_payload.all_headers)?),
        created_at: Utc::now(), // Omitted - set default/ignored
        updated_at: Utc::now(), // Omitted - set default/ignored
    })
}

pub fn parse_address_header(header_value: &str) -> Vec<(Option<String>, String)> {
    // First try with the full header value
    match addrparse(header_value) {
        Ok(addrs) => process_parsed_addresses(&addrs),
        Err(e) => {
            // only retry addresses that unexpectedly terminated due to reaching length limit
            let is_retryable = header_value.contains(">,");
            if is_retryable {
                // Try to salvage by removing everything after the last occurrence of ">, "
                // First check for the pattern ">,"
                let idx = header_value.rfind(">,");
                // Include the ">" in the truncated string, so add 1 to the index
                let truncated_value = &header_value[..(idx.unwrap() + 1)];
                match addrparse(truncated_value) {
                    Ok(addrs) => {
                        return process_parsed_addresses(&addrs);
                    }
                    Err(e2) => {
                        tracing::warn!(
                            error = %e,
                            retried_error = %e2,
                            header = header_value,
                            truncated = truncated_value,
                            "Failed to parse address header even after truncation"
                        );
                    }
                }
            }
            Vec::new()
        }
    }
}

/// Helper function to process successfully parsed mail addresses
fn process_parsed_addresses(addrs: &MailAddrList) -> Vec<(Option<String>, String)> {
    let mut results = Vec::new();
    for mail_addr in addrs.iter() {
        match mail_addr {
            MailAddr::Single(info) => {
                results.push((info.display_name.clone(), info.addr.clone()));
            }
            MailAddr::Group(info) => {
                for single_info in info.addrs.iter() {
                    results.push((single_info.display_name.clone(), single_info.addr.clone()));
                }
            }
        }
    }
    results
}

/// Find header value by name (case-insensitive)
pub fn find_header<'a>(headers: &'a [Header], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_address_header_valid() {
        // Test with a single address
        let header = "John Doe <john@example.com>";
        let result = parse_address_header(header);
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            (Some("John Doe".to_string()), "john@example.com".to_string())
        );

        // Test with multiple addresses
        let header = "John Doe <john@example.com>, Jane Smith <jane@example.com>";
        let result = parse_address_header(header);
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            (Some("John Doe".to_string()), "john@example.com".to_string())
        );
        assert_eq!(
            result[1],
            (
                Some("Jane Smith".to_string()),
                "jane@example.com".to_string()
            )
        );

        // Test with no display name
        let header = "<no-name@example.com>";
        let result = parse_address_header(header);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], (None, "no-name@example.com".to_string()));

        // Test with group address format
        let header = "Group: John <john@example.com>, Jane <jane@example.com>;";
        let result = parse_address_header(header);
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            (Some("John".to_string()), "john@example.com".to_string())
        );
        assert_eq!(
            result[1],
            (Some("Jane".to_string()), "jane@example.com".to_string())
        );
    }

    #[test]
    fn test_parse_address_header_with_truncation() {
        // Test with truncated email that would fail normal parsing
        let header = "John Doe <john@example.com>, Jane Smith <jane@example.com>, Incomplete <partial@example";
        let result = parse_address_header(header);

        // Should successfully parse the first two addresses by truncating at the last comma
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            (Some("John Doe".to_string()), "john@example.com".to_string())
        );
        assert_eq!(
            result[1],
            (
                Some("Jane Smith".to_string()),
                "jane@example.com".to_string()
            )
        );

        // Another example with missing '>' at the end
        let header = "John <john@example.com>, Partial <email@domain";
        let result = parse_address_header(header);
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            (Some("John".to_string()), "john@example.com".to_string())
        );
    }

    #[test]
    fn test_parse_address_header_with_invalid_format() {
        // Test with invalid format but contains withheld (should return empty)
        let header = "(withheld recipients)";
        let result = parse_address_header(header);
        assert!(result.is_empty());

        // Test with completely invalid format (no comma to truncate)
        let header = "This is not an email address";
        let result = parse_address_header(header);
        assert!(result.is_empty());

        // Test with empty string
        let header = "";
        let result = parse_address_header(header);
        assert!(result.is_empty());
    }

    #[test]
    fn test_parse_address_header_real_world_example() {
        // The example from the problem description
        let header = "Evan Macrotest <evanmacrotest@outlook.com>, evanmacrotest <evanmacrotest@gmail.com>, Recipient Name <evan.hutnik@gm";
        let result = parse_address_header(header);

        // Should successfully parse the first two addresses
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            (
                Some("Evan Macrotest".to_string()),
                "evanmacrotest@outlook.com".to_string()
            )
        );
        assert_eq!(
            result[1],
            (
                Some("evanmacrotest".to_string()),
                "evanmacrotest@gmail.com".to_string()
            )
        );
    }

    #[test]
    fn test_parse_address_header_still_invalid_after_truncation() {
        // Test case where even after truncation, the format is still invalid
        let header = "Invalid <not-an-email@, Another <not-an-email@";
        let result = parse_address_header(header);
        assert!(result.is_empty());
    }

    #[test]
    fn test_process_parsed_addresses() {
        // This test requires creating mock MailAddrList objects
        // We can test this indirectly through the parse_address_header function
        // with valid inputs, which will call process_parsed_addresses internally

        let header = "John <john@example.com>, Jane <jane@example.com>";
        let result = parse_address_header(header);
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            (Some("John".to_string()), "john@example.com".to_string())
        );
        assert_eq!(
            result[1],
            (Some("Jane".to_string()), "jane@example.com".to_string())
        );
    }

    #[test]
    fn test_parse_address_header_with_quoted_display_names_and_commas() {
        // Test case with quotes and commas in display names and a truncated email at the end
        let header = "\"Asdf, Fdsa\" <asdf.fdsa@ff.com>, \"aaa, ddd\" <aaa.ddd@ff";
        let result = parse_address_header(header);

        // Should successfully parse the first address by truncating at the last comma
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            (
                Some("Asdf, Fdsa".to_string()),
                "asdf.fdsa@ff.com".to_string()
            )
        );

        // Another similar case but with three addresses
        let header = "\"First, Last\" <first.last@example.com>, \"Second, Name\" <second@example.com>, \"Third, Complex, Name\" <third@incomplete";
        let result = parse_address_header(header);
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            (
                Some("First, Last".to_string()),
                "first.last@example.com".to_string()
            )
        );
        assert_eq!(
            result[1],
            (
                Some("Second, Name".to_string()),
                "second@example.com".to_string()
            )
        );

        // Case where a quoted comma appears at the beginning of the string
        let header = "\"Initial, With, Commas\" <initial@example.com>";
        let result = parse_address_header(header);
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            (
                Some("Initial, With, Commas".to_string()),
                "initial@example.com".to_string()
            )
        );
    }
}
