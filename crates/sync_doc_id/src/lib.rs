//! Shared sync-service key for documents and collaborative surfaces.
#![deny(missing_docs)]

/// A non-empty opaque sync key. It need not be a document UUID.
#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(try_from = "String", into = "String")]
pub struct SyncDocId(String);

/// A sync-service key cannot be empty.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("sync document id cannot be empty")]
pub struct SyncDocIdError;

impl SyncDocId {
    /// Validate an opaque sync key without altering its stored text.
    pub fn new(value: String) -> Result<Self, SyncDocIdError> {
        if value.is_empty() {
            Err(SyncDocIdError)
        } else {
            Ok(Self(value))
        }
    }
    /// Borrow the exact transport key.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl TryFrom<String> for SyncDocId {
    type Error = SyncDocIdError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}
impl std::str::FromStr for SyncDocId {
    type Err = SyncDocIdError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::new(value.to_owned())
    }
}
impl std::fmt::Display for SyncDocId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::borrow::Borrow<str> for SyncDocId {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}
impl From<SyncDocId> for String {
    fn from(value: SyncDocId) -> Self {
        value.0
    }
}
impl From<document_id::DocumentId> for SyncDocId {
    fn from(value: document_id::DocumentId) -> Self {
        Self(value.into_inner())
    }
}

#[cfg(test)]
mod test;
