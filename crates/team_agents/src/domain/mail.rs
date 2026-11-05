//! Validated provider identifiers used by the agent email ports.

use serde::{Deserialize, Serialize};

/// An email-provider identifier must be a bounded, nonempty URL path segment.
#[derive(Debug, Clone, Copy, thiserror::Error)]
#[error("invalid email provider identifier")]
pub struct InvalidMailId;

fn validate(raw: &str) -> Result<(), InvalidMailId> {
    if !lazy_regex::regex_is_match!(r"^[A-Za-z0-9_-]{1,255}$", raw) {
        return Err(InvalidMailId);
    }
    Ok(())
}

/// A mailbox identifier returned by the email provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct MailboxId(String);

impl MailboxId {
    /// Validate a provider identifier before using it in a request or stored row.
    pub fn parse(raw: String) -> Result<Self, InvalidMailId> {
        validate(&raw)?;
        Ok(Self(raw))
    }

    /// The provider's original identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for MailboxId {
    type Error = InvalidMailId;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        Self::parse(raw)
    }
}

impl From<MailboxId> for String {
    fn from(id: MailboxId) -> Self {
        id.0
    }
}

impl std::fmt::Display for MailboxId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A message identifier returned by the email provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct MailMessageId(String);

impl MailMessageId {
    /// Validate a provider identifier before using it in a request or stored row.
    pub fn parse(raw: String) -> Result<Self, InvalidMailId> {
        validate(&raw)?;
        Ok(Self(raw))
    }

    /// The provider's original identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for MailMessageId {
    type Error = InvalidMailId;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        Self::parse(raw)
    }
}

impl From<MailMessageId> for String {
    fn from(id: MailMessageId) -> Self {
        id.0
    }
}

impl std::fmt::Display for MailMessageId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A thread identifier returned by the email provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct MailThreadId(String);

impl MailThreadId {
    /// Validate a provider identifier before using it in a request or stored row.
    pub fn parse(raw: String) -> Result<Self, InvalidMailId> {
        validate(&raw)?;
        Ok(Self(raw))
    }

    /// The provider's original identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for MailThreadId {
    type Error = InvalidMailId;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        Self::parse(raw)
    }
}

impl From<MailThreadId> for String {
    fn from(id: MailThreadId) -> Self {
        id.0
    }
}

impl std::fmt::Display for MailThreadId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[cfg(test)]
mod test;
