use std::ops::Deref;

use ego_tree::NodeRef;
use models_email::service::message::Message;
use models_email::service::thread::Thread;
use scraper::{ElementRef, Html, Node};

pub fn remove_trailing_br_tags_threads(threads: &mut [Thread]) {
    for thread in threads.iter_mut() {
        for message in thread.messages.iter_mut() {
            remove_trailing_br_tags(message);
        }
    }
}

// removes any trailing brs from body_html_sanitized
pub fn remove_trailing_br_tags(message: &mut Message) {
    // Clean body_html_sanitized if it exists
    if let Some(body_html_sanitized) = message.body_html_sanitized.as_ref() {
        let document = Html::parse_fragment(body_html_sanitized);
        message.body_html_sanitized = Some(recursively_build_cleaned_html(document.root_element()))
    }
}

/// Recursively traverses a node's children in reverse, rebuilding the inner HTML
/// while discarding any trailing insignificant nodes (like `<br>`s or empty containers).
fn recursively_build_cleaned_html(element: ElementRef) -> String {
    let children: Vec<_> = element.children().collect();
    let mut cleaned_child_parts: Vec<String> = Vec::new();
    let mut content_found = false;

    // Iterate through children in REVERSE to find the last piece of real content.
    for child in children.into_iter().rev() {
        let mut current_part = String::new();
        let mut is_part_contentful = false;

        if let Some(el) = ElementRef::wrap(child) {
            // `<img>` tags are always considered content.
            if el.value().name().eq_ignore_ascii_case("img") {
                is_part_contentful = true;
                current_part = el.html();
            } else {
                // For any other element, we must clean its children first.
                let cleaned_inner_html = recursively_build_cleaned_html(el);

                // An element is only contentful if its cleaned children are not empty.
                if !cleaned_inner_html.trim().is_empty() {
                    is_part_contentful = true;
                    // Rebuild the outer tag around the newly cleaned inner content.
                    let tag_name = el.value().name();
                    let attrs_string = el
                        .value()
                        .attrs()
                        .map(|(k, v)| format!(" {}=\"{}\"", k, html_escape::encode_text(v)))
                        .collect::<String>();
                    current_part = format!(
                        "<{}{}>{}</{}>",
                        tag_name, attrs_string, cleaned_inner_html, tag_name
                    );
                }
            }
        } else if let Some(text) = child.value().as_text() {
            // A text node is contentful if it's not just whitespace.
            if !text.trim().is_empty() {
                is_part_contentful = true;
            }
            // We always keep text nodes initially; they get trimmed out if they are trailing.
            current_part = text.to_string();
        }
        // We ignore comments and other node types as non-content.

        if content_found {
            // Content has already been found, so keep everything we see from now on.
            // We need to re-serialize the original node to preserve it perfectly.
            cleaned_child_parts.push(serialize_node(child));
        } else if is_part_contentful {
            // This is the first piece of content we've found from the end.
            content_found = true;
            cleaned_child_parts.push(current_part);
        }
        // If content_found is false and is_part_contentful is false, we do nothing,
        // effectively discarding the trailing insignificant node.
    }

    // The parts were collected in reverse, so reverse them back.
    cleaned_child_parts.reverse();
    cleaned_child_parts.join("")
}

/// A helper to serialize any `NodeRef` back to an HTML string.
fn serialize_node(node: NodeRef<Node>) -> String {
    if let Some(element) = ElementRef::wrap(node) {
        element.html()
    } else if let Some(text) = node.value().as_text() {
        text.to_string()
    } else if let Some(comment) = node.value().as_comment() {
        format!("<!--{}-->", comment.deref())
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use crate::util::process_pre_insert::clean_message::clean_message;
    use models_email::email::service;

    #[test]
    fn test_clean_html_test_1() {
        // Given an email with Outlook-style formatting and a "From:" separator
        let full_email = include_str!("testdata/test-1/dirty.html");
        let expected_reply = include_str!("testdata/test-1/clean.html");

        test_clean_html(full_email, expected_reply, "test-1");
    }

    fn test_clean_html(dirty_html: &str, expected_clean_html: &str, test_name: &str) {
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
            body_html_sanitized: Some(dirty_html.to_string()),
            body_text: None,
            attachments: vec![],
            attachments_macro: vec![],
            headers_json: None,
            created_at: Default::default(),
            labels: vec![],
            body_macro: None,
            updated_at: Default::default(),
        };

        // When we extract the reply
        clean_message(&mut message);

        assert_eq!(
            message
                .body_html_sanitized
                .unwrap()
                .replace(" ", "")
                .replace("\n", "")
                .trim(),
            expected_clean_html
                .replace(" ", "")
                .replace("\n", "")
                .trim(),
            "Test '{}' failed: extracted reply doesn't match expected",
            test_name
        );
    }
}
