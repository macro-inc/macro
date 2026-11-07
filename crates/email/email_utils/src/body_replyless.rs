mod constants;
mod html_parser;
mod plaintext_parser;
#[cfg(test)]
mod test;

use html_parser::extract_reply_html;
use plaintext_parser::extract_reply_plaintext;

/// Graph's `bodyPreview` length.
const SNIPPET_CHARS: usize = 255;

/// Computes the body of a message with reply/forwarded-thread content stripped.
///
/// Returns `None` if the message has neither HTML nor plaintext body content.
pub fn compute_body_replyless(
    subject: Option<&str>,
    body_html_sanitized: Option<&str>,
    body_text: Option<&str>,
) -> Option<String> {
    if let Some(sanitized) = body_html_sanitized {
        Some(extract_reply_html(subject, sanitized))
    } else {
        body_text.map(|body| extract_reply_plaintext(subject, body))
    }
}

pub fn reply_snippet(
    subject: Option<&str>,
    body_html_sanitized: Option<&str>,
    body_text: Option<&str>,
) -> Option<String> {
    let reply = compute_body_replyless(subject, body_html_sanitized, body_text)?;
    let reply = match body_html_sanitized {
        Some(_) => crate::body_parsed::html_to_plaintext(&reply)?,
        None => reply,
    };
    let snippet: String = reply
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(SNIPPET_CHARS)
        .collect();
    (!snippet.is_empty()).then_some(snippet)
}
