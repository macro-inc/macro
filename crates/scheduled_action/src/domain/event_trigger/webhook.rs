//! A POST to a routine's webhook URL: arbitrary text from outside Macro.

use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[cfg(test)]
mod test;

/// Bytes a webhook body may take. Like a GitHub delivery's payload, it is
/// kept with its run until the run finishes.
pub const MAX_WEBHOOK_BODY_BYTES: usize = 64 * 1024;
/// Characters of the `Content-Type` header kept.
const MAX_CONTENT_TYPE_CHARS: usize = 255;

/// One delivery to a routine's webhook URL. It names the routine whose URL
/// received it, and runs no other.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebhookDelivery {
    pub routine_id: Uuid,
    /// The body as sent. Absent once its run has finished.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// The sender's `Content-Type`, when it sent one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum WebhookBodyError {
    #[error("a webhook body can be at most 64 KiB")]
    TooLarge,
    #[error("a webhook body must be UTF-8 text")]
    NotText,
}

impl WebhookDelivery {
    /// A delivery of `body` to `routine_id`; the body must be UTF-8 text.
    pub fn new(
        routine_id: Uuid,
        body: &[u8],
        content_type: Option<&str>,
    ) -> Result<Self, WebhookBodyError> {
        if body.len() > MAX_WEBHOOK_BODY_BYTES {
            return Err(WebhookBodyError::TooLarge);
        }
        let body = std::str::from_utf8(body).map_err(|_| WebhookBodyError::NotText)?;
        Ok(Self {
            routine_id,
            body: Some(body.to_owned()),
            content_type: content_type
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.chars().take(MAX_CONTENT_TYPE_CHARS).collect()),
        })
    }

    /// The body read as JSON, when it is JSON, whatever its `Content-Type`
    /// says. Payload tests run against it.
    pub fn json(&self) -> Option<Value> {
        serde_json::from_str(self.body.as_deref()?).ok()
    }
}
