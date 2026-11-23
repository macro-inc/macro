//! Structured details for the workspace review card.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::NotionReportItem;

/// Objects confirmed in the current Notion write's ledger.
#[derive(
    Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, specta::Type, ToSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmedNotionWrites {
    /// Copied pages.
    pub documents: u32,
    /// Copied databases.
    pub databases: u32,
    /// Rows inserted into copied databases.
    pub database_rows: u32,
    /// Databases copied as task lists.
    pub task_lists: u32,
    /// Tasks inserted into those lists.
    pub tasks: u32,
}

/// The kind and severity of a user-visible change to a saved view.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
    JsonSchema,
    specta::Type,
    ToSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum NotionViewChangeKind {
    /// The filter may return extra rows.
    Filter,
    /// The layout or grouping changed.
    Layout,
    /// The order of rows may change.
    Sort,
    /// Columns hidden in Notion are visible.
    Visibility,
    /// Other display settings.
    Display,
}

/// A counted, readable difference in an imported view.
#[derive(
    Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, specta::Type, ToSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct NotionViewChange {
    /// Semantic category used for ordering and grouping.
    pub kind: NotionViewChangeKind,
    /// Number of changed settings represented in this line.
    pub count: u32,
    /// Human-readable description.
    pub message: String,
}

/// Changes to one view of an imported database.
#[derive(
    Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, specta::Type, ToSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct NotionChangedView {
    /// Stable Notion identity, separate from the title.
    pub view_id: String,
    /// Display title.
    pub title: String,
    /// Changes ordered by impact.
    pub changes: Vec<NotionViewChange>,
}

/// Views that changed on one database.
#[derive(
    Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, specta::Type, ToSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct NotionDatabaseViewChanges {
    /// Stable Notion data source identity.
    pub database_id: String,
    /// Display title.
    pub title: String,
    /// Views ordered by their highest impact.
    pub views: Vec<NotionChangedView>,
}

/// A first-tab choice when Notion omitted the view from a reference.
#[derive(
    Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, specta::Type, ToSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct NotionTabChoice {
    /// Container identity. Different linked placements may choose different tabs.
    pub container_id: String,
    /// Database name shown in the reference.
    pub database: String,
    /// Name of the returned first tab.
    pub tab: String,
}

/// Why an item was left for the user in the reviewed plan.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, specta::Type, ToSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum NotionReviewOmissionKind {
    /// The plan proposed leaving the item out and the review kept that choice.
    LeftOut,
    /// The review excluded a proposed copy.
    Excluded,
    /// The plan left this item for manual handling.
    ByHand,
}

/// A review choice and the item it left out.
#[derive(
    Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, specta::Type, ToSchema,
)]
pub struct NotionReviewOmission {
    /// Which review choice led to the omission.
    pub kind: NotionReviewOmissionKind,
    /// Source title, link and review reason.
    pub item: NotionReportItem,
}

/// Content-level notes that do not describe a saved view or a reviewed skip.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, specta::Type, ToSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum NotionReportNoteKind {
    /// Part of the source could not be copied.
    Omitted,
    /// A calculated value was kept as a fixed snapshot.
    Snapshot,
    /// A reference uses a different destination, such as a source link.
    Reference,
    /// Other source details, including legacy notices.
    Other,
}

/// A counted content or compatibility note.
#[derive(
    Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, specta::Type, ToSchema,
)]
pub struct NotionReportNote {
    /// Semantic category.
    pub kind: NotionReportNoteKind,
    /// Number of incidents represented by this notice.
    pub count: u32,
    /// Human-readable text, with affected source and property titles.
    pub message: String,
}

/// Details alongside the outcome on a Notion import card.
#[derive(
    Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, specta::Type, ToSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct NotionReportDetails {
    /// Items deliberately left out, with every reviewed reason.
    pub not_imported: Vec<NotionReviewOmission>,
    /// Saved view differences, grouped by source and view identity.
    pub view_changes: Vec<NotionDatabaseViewChanges>,
    /// Tab selections caused by an unspecified Notion tab.
    pub tab_choices: Vec<NotionTabChoice>,
    /// Remaining notices, including legacy entries and non-view fidelity changes.
    pub notes: Vec<NotionReportNote>,
}
