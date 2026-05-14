//! Grouping utilities for soup queries.

use serde::Serialize;

/// Metadata about a group of items.
#[derive(Debug, Clone, Serialize)]
pub struct GroupMeta {
    /// Group key - format depends on group_by field:
    /// - Date: "today", "yesterday", "this_week", "last_week", "this_month", "last_month", "older"
    /// - EntityType: "document", "email", "channel", "chat", "project", "call"
    /// - Project: project UUID or empty string for unset
    /// - Property: option UUID or empty string for unset
    pub key: String,

    /// Human-readable label for the group
    pub label: String,

    /// Display order for sorting groups (lower = first)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_order: Option<i32>,

    /// Total count of items in this group across all pages
    pub total_count: u32,

    /// Number of items from this group in the current page
    pub page_count: u32,

    /// Index in the items array where this group starts (current page)
    pub start_index: u32,

    /// Cursor to load more items specifically from this group
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// Fixed date bucket keys and utilities.
pub mod date_buckets {
    /// Today bucket key
    pub const TODAY: &str = "today";
    /// Yesterday bucket key
    pub const YESTERDAY: &str = "yesterday";
    /// This week bucket key (2-6 days ago)
    pub const THIS_WEEK: &str = "this_week";
    /// Last week bucket key (7-13 days ago)
    pub const LAST_WEEK: &str = "last_week";
    /// This month bucket key (14-30 days ago)
    pub const THIS_MONTH: &str = "this_month";
    /// Last month bucket key (31-60 days ago)
    pub const LAST_MONTH: &str = "last_month";
    /// Older bucket key (60+ days ago)
    pub const OLDER: &str = "older";

    /// Get human-readable label for a date bucket key.
    pub fn label(key: &str) -> &'static str {
        match key {
            TODAY => "Today",
            YESTERDAY => "Yesterday",
            THIS_WEEK => "This Week",
            LAST_WEEK => "Last Week",
            THIS_MONTH => "This Month",
            LAST_MONTH => "Last Month",
            _ => "Older",
        }
    }

    /// Get display order for a date bucket key (lower = more recent).
    pub fn display_order(key: &str) -> i32 {
        match key {
            TODAY => 0,
            YESTERDAY => 1,
            THIS_WEEK => 2,
            LAST_WEEK => 3,
            THIS_MONTH => 4,
            LAST_MONTH => 5,
            _ => 6,
        }
    }
}

/// Entity type labels for grouping.
pub mod entity_type_labels {
    /// Get human-readable label for an entity type key.
    pub fn label(key: &str) -> &'static str {
        match key {
            "document" => "Documents",
            "email" => "Emails",
            "channel" => "Messages",
            "chat" => "Chats",
            "project" => "Projects",
            "call" => "Calls",
            _ => "Other",
        }
    }

    /// Get display order for an entity type key.
    pub fn display_order(key: &str) -> i32 {
        match key {
            "document" => 0,
            "email" => 1,
            "channel" => 2,
            "chat" => 3,
            "project" => 4,
            "call" => 5,
            _ => 6,
        }
    }
}
