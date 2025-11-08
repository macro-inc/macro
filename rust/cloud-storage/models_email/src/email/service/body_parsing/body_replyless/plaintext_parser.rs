use crate::service::body_parsing::body_replyless::constants::PLAINTEXT_SPLITTER_RE;

/// Extracts the latest reply from a plaintext email string.
pub fn extract_reply_plaintext(subject: Option<&str>, text_content: &str) -> String {
    if subject.is_some() && subject.unwrap().starts_with("Fwd:") {
        return text_content.to_string();
    }

    let mut reply_slice = text_content;

    // Find the first occurrence of a splitter line. If found, the reply is
    // everything before it.
    if let Some(splitter_match) = PLAINTEXT_SPLITTER_RE.find(text_content) {
        reply_slice = &text_content[..splitter_match.start()];
    }

    reply_slice.trim().to_string()
}
