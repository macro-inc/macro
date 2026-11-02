//! Request-scoped negotiation for the Mail cache capsule.

/// HTTP clients advertise the same profile as WebSocket connection-init clients.
pub const MAIL_CACHE_PROFILE_HEADER: &str = "x-macro-mail-cache-profile";

/// Only an explicit capability opts into capsules older native engines reject.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MailCacheProfile {
    /// Whether the caller understands the spam/trash-free Mail projection.
    current: bool,
}

impl MailCacheProfile {
    /// Unknown or absent capabilities retain the deployed v2 wire contract.
    pub fn from_advertised(version: Option<&str>) -> Self {
        Self {
            current: version == Some("soup-mail-v5"),
        }
    }

    /// Whether this request may receive v5 capsules.
    pub(crate) fn is_current(self) -> bool {
        self.current
    }
}

#[cfg(test)]
mod test;
