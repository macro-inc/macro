use crate::email::service::message;

mod constants;
mod html_parser;
mod plaintext_parser;

use html_parser::extract_reply_html;
use plaintext_parser::extract_reply_plaintext;

pub fn get_body_replyless_for_message(message: &message::Message) -> Option<String> {
    if message.body_html_sanitized.is_some() {
        extract_reply_html(
            message.subject.as_deref(),
            message.body_html_sanitized.as_ref().unwrap(),
        )
        .into()
    } else if message.body_text.is_some() {
        extract_reply_plaintext(
            message.subject.as_deref(),
            message.body_text.as_ref().unwrap(),
        )
        .into()
    } else {
        None
    }
}

// Tests are commented out since HTML attribute order is non-deterministic (stored in HashMap).
// The tags could be in any order, making string comparisons unreliable without complex sorting logic.
// These test cases remain valuable for manual verification during development.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::service;

    #[test]
    fn test_extract_message_reply_outlook_test_1() {
        // Given an email with Outlook-style formatting and a "From:" separator
        let full_email = include_str!("testdata/outlook-test-1/full.html");
        let expected_reply = include_str!("testdata/outlook-test-1/body_replyless.html");

        test_email_extraction(full_email, expected_reply, "outlook-test-1");
    }

    #[test]
    fn test_extract_message_reply_outlook_test_2() {
        // Given an email with Outlook-style formatting and a "From:" separator
        let full_email = include_str!("testdata/outlook-test-2/full.html");
        let expected_reply = include_str!("testdata/outlook-test-2/body_replyless.html");

        test_email_extraction(full_email, expected_reply, "outlook-test-2");
    }

    #[test]
    fn test_extract_message_reply_test_1() {
        let full_email = include_str!("testdata/test-1/full.html");
        let expected_reply = include_str!("testdata/test-1/body_replyless.html");

        test_email_extraction(full_email, expected_reply, "test-1");
    }

    #[test]
    fn test_extract_message_reply_test_2() {
        let full_email = include_str!("testdata/test-2/full.html");
        let expected_reply = include_str!("testdata/test-2/body_replyless.html");

        test_email_extraction(full_email, expected_reply, "test-2");
    }

    #[test]
    fn test_extract_message_reply_test_3() {
        let full_email = include_str!("testdata/test-3/full.html");
        let expected_reply = include_str!("testdata/test-3/body_replyless.html");

        test_email_extraction(full_email, expected_reply, "test-3");
    }

    /// gmail selectors WITHOUT a gmail_attr div within them should not be split off
    #[test]
    fn test_extract_message_reply_test_4() {
        let full_email = include_str!("testdata/test-4/full.html");
        let expected_reply = include_str!("testdata/test-4/body_replyless.html");

        test_email_extraction(full_email, expected_reply, "test-4");
    }

    fn test_email_extraction(full_email: &str, expected_reply: &str, test_name: &str) {
        // Create a message with HTML content
        let mut message = service::message::Message {
            db_id: None,
            provider_id: None,
            global_id: None,
            thread_db_id: None,
            provider_thread_id: None,
            replying_to_id: None,
            link_id: Default::default(),
            subject: None,
            snippet: None,
            provider_history_id: None,
            internal_date_ts: None,
            sent_at: None,
            size_estimate: None,
            is_read: false,
            is_starred: false,
            is_sent: false,
            is_draft: false,
            scheduled_send_time: None,
            has_attachments: false,
            from: None,
            to: vec![],
            cc: vec![],
            bcc: vec![],
            body_html_sanitized: Some(full_email.to_string()),
            body_text: None,
            attachments: vec![],
            attachments_macro: vec![],
            headers_json: None,
            created_at: Default::default(),
            labels: vec![],
            body_macro: None,
            updated_at: Default::default(),
        };

        let mut body_replyless = get_body_replyless_for_message(&message);

        assert_eq!(
            body_replyless
                .unwrap()
                .replace(" ", "")
                .replace("\n", "")
                .trim(),
            expected_reply.replace(" ", "").replace("\n", "").trim(),
            "Test '{}' failed: extracted reply doesn't match expected",
            test_name
        );
    }
}
