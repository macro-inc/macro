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

impl InboxChanges {
    /// Adds changes the provider recorded after these, with the same result
    /// as reading both in one pass: a later deletion drops an earlier upsert
    /// or label refresh, an earlier deletion blocks later ones, and an upsert
    /// supersedes a label refresh.
    pub fn append_later(&mut self, later: InboxChanges) {
        let earlier = std::mem::take(self);
        self.message_ids_to_upsert = earlier
            .message_ids_to_upsert
            .difference(&later.message_ids_to_delete)
            .chain(
                later
                    .message_ids_to_upsert
                    .difference(&earlier.message_ids_to_delete),
            )
            .cloned()
            .collect();
        self.labels_to_update = earlier
            .labels_to_update
            .iter()
            .filter(|id| {
                !later.message_ids_to_upsert.contains(*id)
                    && !later.message_ids_to_delete.contains(*id)
            })
            .chain(later.labels_to_update.iter().filter(|id| {
                !earlier.message_ids_to_upsert.contains(*id)
                    && !earlier.message_ids_to_delete.contains(*id)
            }))
            .cloned()
            .collect();
        self.message_ids_to_delete = earlier
            .message_ids_to_delete
            .union(&later.message_ids_to_delete)
            .cloned()
            .collect();
    }
}

/// One provider page of inbox changes following a cursor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangePage {
    /// Changes recorded in this page.
    pub changes: InboxChanges,
    /// The mailbox's cursor when the page was read, if the provider reported one.
    pub cursor: Option<SyncCursor>,
    /// Opaque token for the next page, or `None` when this is the last page.
    pub next_page_token: Option<String>,
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
