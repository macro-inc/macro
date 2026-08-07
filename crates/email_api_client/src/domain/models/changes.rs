use std::collections::HashSet;

use serde::{Deserialize, Serialize};

/// A provider cursor from which incremental synchronization can continue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SyncCursor {
    /// A Gmail history identifier.
    Gmail(String),
}

impl SyncCursor {
    /// Creates a Gmail synchronization cursor.
    pub fn gmail(history_id: impl Into<String>) -> Self {
        Self::Gmail(history_id.into())
    }

    /// Returns the provider cursor's opaque value.
    pub fn as_str(&self) -> &str {
        match self {
            Self::Gmail(history_id) => history_id,
        }
    }
}

/// Provider-neutral inbox mutations discovered during incremental synchronization.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InboxChanges {
    /// Provider message identifiers that must be inserted or refreshed.
    pub message_ids_to_upsert: HashSet<String>,
    /// Provider message identifiers that have been permanently deleted.
    pub message_ids_to_delete: HashSet<String>,
    /// Provider message identifiers whose labels must be refreshed.
    pub labels_to_update: HashSet<String>,
}

/// A page of inbox changes and the cursor that follows those changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangeBatch {
    /// Changes represented by this batch.
    pub changes: InboxChanges,
    /// Cursor to persist after the batch has been accepted.
    pub next_cursor: SyncCursor,
}

impl ChangeBatch {
    /// Creates a change batch ending at `next_cursor`.
    pub fn new(changes: InboxChanges, next_cursor: SyncCursor) -> Self {
        Self {
            changes,
            next_cursor,
        }
    }
}

#[cfg(test)]
mod test;
