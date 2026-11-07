//! Group metadata for responses.

use serde::Serialize;

/// Metadata about a group of items in the response.
#[derive(Debug, Clone, Serialize)]
#[non_exhaustive]
pub struct GroupMeta {
    /// Unique key identifying the group
    pub key: String,
    /// Human-readable label
    pub label: String,
    /// Display order (lower = first)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_order: Option<i32>,
    /// Total items in this group (across all pages)
    pub total_count: u32,
    /// Items from this group in current page
    pub page_count: u32,
    /// Index where this group starts in items array
    pub start_index: u32,
    /// Cursor to load more from this group
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

impl GroupMeta {
    /// Create a new group metadata entry.
    pub fn new(key: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            label: label.into(),
            display_order: None,
            total_count: 0,
            page_count: 0,
            start_index: 0,
            next_cursor: None,
        }
    }

    /// Returns true if this group has more items to load.
    pub fn has_more(&self) -> bool {
        self.next_cursor.is_some()
    }
}
