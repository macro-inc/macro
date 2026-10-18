//! Meta content interpretation, independent of native markup and storage.

use super::{
    content::*,
    events::{IncomingMessage, instagram_permalink},
    models::Provider,
};

/// Normalize only supported supplied links; every other provider byte stays plain text.
pub fn normalize(message: &IncomingMessage) -> NormalizedContent<'_> {
    let shared_content = message.provider == Provider::Instagram
        && matches!(message.message_type.as_str(), "ig_post" | "ig_reel");
    let lines = message
        .content
        .split('\n')
        .map(|line| {
            if shared_content && let Some(url) = instagram_permalink(line) {
                ContentLine::Link(SuppliedLink(url))
            } else {
                ContentLine::Text(line)
            }
        })
        .collect();
    NormalizedContent { lines }
}
