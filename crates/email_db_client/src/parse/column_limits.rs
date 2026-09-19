//! Character limits of the `varchar(n)` columns that provider-sourced strings
//! land in.
//!
//! Gmail hands us headers with no length contract of its own, so a single
//! oversized value (a 500-char one-click-unsubscribe `To:` address, a runaway
//! `From:` display name) used to abort the whole message insert with SQLSTATE
//! 22001. Clamping here — at the service-to-db mapping boundary every insert
//! path funnels through — keeps the message itself ingestible.
//!
//! Postgres counts `varchar(n)` in characters, not bytes, so every limit below
//! is a character count and truncation is done on char boundaries.

/// `email_contacts.email_address`
pub(crate) const EMAIL_ADDRESS: usize = 320;

/// `email_contacts.name`, `email_message_recipients.name`,
/// `email_messages.from_name`
pub(crate) const CONTACT_NAME: usize = 255;

/// `email_attachments.filename`
pub(crate) const ATTACHMENT_FILENAME: usize = 512;

/// `email_attachments.mime_type`
pub(crate) const ATTACHMENT_MIME_TYPE: usize = 255;

/// `email_attachments.content_id`
pub(crate) const ATTACHMENT_CONTENT_ID: usize = 255;

/// True when `value` fits the column without truncation.
pub(crate) fn fits(value: &str, limit: usize) -> bool {
    value.chars().count() <= limit
}

/// Clamps `value` to `limit` characters, returning it untouched when it
/// already fits.
pub(crate) fn clamp(value: String, limit: usize) -> String {
    match value.char_indices().nth(limit) {
        Some((byte_offset, _)) => {
            let mut clamped = value;
            clamped.truncate(byte_offset);
            clamped
        }
        None => value,
    }
}

/// Clamps an optional column value, logging once per truncation so oversized
/// provider data stays visible.
pub(crate) fn clamp_opt(
    value: Option<String>,
    limit: usize,
    column: &'static str,
) -> Option<String> {
    value.map(|value| {
        if fits(&value, limit) {
            return value;
        }
        tracing::warn!(
            column,
            limit,
            length = value.chars().count(),
            "truncating oversized provider value to fit its column"
        );
        clamp(value, limit)
    })
}

#[cfg(test)]
mod test;
