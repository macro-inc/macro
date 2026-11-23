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
    /// Rows inserted into databases, including writes from unfinished copies.
    pub database_rows: u32,
    /// The subset of database rows written before their source stopped.
    #[serde(default)]
    pub partial_database_rows: u32,
    /// Databases copied as task lists.
    pub task_lists: u32,
    /// Tasks inserted into task lists, including writes from unfinished lists.
    pub tasks: u32,
    /// The subset of tasks written before their source stopped.
    #[serde(default)]
    pub partial_tasks: u32,
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
    /// Title of the page or row containing the reference.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container_title: Option<String>,
    /// Database name shown in the reference.
    pub database: String,
    /// Name of the returned first tab.
    pub tab: String,
}

/// Why an item was left for the user in the reviewed plan.
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

/// Counts for one review choice, including items outside the sample.
#[derive(
    Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, specta::Type, ToSchema,
)]
pub struct NotionReviewOmissionCount {
    /// The reviewed choice responsible.
    pub kind: NotionReviewOmissionKind,
    /// Pages left out.
    pub pages: u32,
    /// Databases left out.
    pub databases: u32,
    /// Other objects left out.
    pub other: u32,
}

/// Content-level notes that do not describe a saved view or a reviewed skip.
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

/// Counts for one kind of content note, including notes outside the sample.
#[derive(
    Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, specta::Type, ToSchema,
)]
pub struct NotionReportNoteCount {
    /// Semantic category.
    pub kind: NotionReportNoteKind,
    /// Number of notices.
    pub lines: u32,
    /// Number of incidents described by the notices.
    pub count: u32,
}

/// Details alongside the outcome on a Notion import card.
#[derive(
    Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, specta::Type, ToSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct NotionReportDetails {
    /// A sample of items deliberately left out, with the reviewed reasons.
    pub not_imported: Vec<NotionReviewOmission>,
    /// Totals for each review choice.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub omission_counts: Vec<NotionReviewOmissionCount>,
    /// Saved view differences, sampled by impact and grouped by source and view.
    pub view_changes: Vec<NotionDatabaseViewChanges>,
    /// Total number of changed views.
    #[serde(default)]
    pub view_count: u32,
    /// Total number of displayed and undisplayed change lines.
    #[serde(default)]
    pub view_change_count: u32,
    /// A sample of tab selections caused by an unspecified Notion tab.
    pub tab_choices: Vec<NotionTabChoice>,
    /// Total number of placements that used a default tab.
    #[serde(default)]
    pub tab_choice_count: u32,
    /// A sample of legacy notices and non-view fidelity changes.
    pub notes: Vec<NotionReportNote>,
    /// Totals for each kind of notice.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub note_counts: Vec<NotionReportNoteCount>,
}
