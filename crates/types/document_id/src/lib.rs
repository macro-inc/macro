//! The id of a Macro document, task or file.

#![deny(missing_docs)]

use serde::{Deserialize, Serialize};
use std::fmt;

#[cfg(test)]
mod test;

// The doc comment below is the OpenAPI description clients already see.
/// A validated document identifier. Historical document ids need not be UUIDs.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct DocumentId(String);

/// A string that cannot name a document: empty, padded with whitespace, or
/// containing control characters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("invalid document id")]
pub struct InvalidDocumentId;

impl DocumentId {
    /// Validate a received or stored document id.
    pub fn parse(value: &str) -> Result<Self, InvalidDocumentId> {
        Self::try_from(value.to_owned())
    }

    /// The id as stored and sent.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for DocumentId {
    type Error = InvalidDocumentId;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty() || value.trim() != value || value.chars().any(char::is_control) {
            return Err(InvalidDocumentId);
        }
        Ok(Self(value))
    }
}

impl From<DocumentId> for String {
    fn from(value: DocumentId) -> Self {
        value.0
    }
}

impl AsRef<str> for DocumentId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for DocumentId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}
