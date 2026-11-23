//! The removed `ReadActivity` tool, kept so saved chats that called it still
//! render. `macro.activity.mine()` reads the same range in code mode.
use activity::domain::activity_range::ReadActivityResponse;
use ai_toolset::schema::PhantomTool;
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::Serialize;

/// Tool: read the authenticated user's own activity in a time range.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadActivity",
    description = "Read actions attributed to the authenticated user within a time range, newest first. Use this for questions about what the user did, including actions an agent performed on their behalf. Property changes include propertyName/propertyType plus fromLabels/toLabels for resolved select and tag values; use those human-readable fields in the answer and never expose property or option ids. Do not use this for organization-wide updates or everything that happened to entities the user can access; use ListEntities for those. Returns at most 100 activities and reports when the result was truncated."
)]
pub struct ReadActivity {
    /// Inclusive start of the time range.
    #[schemars(description = "Inclusive start of the range as an RFC 3339 timestamp.")]
    pub from: DateTime<Utc>,
    /// Exclusive end of the time range.
    #[schemars(
        description = "Exclusive end of the range as an RFC 3339 timestamp. Must be after from."
    )]
    pub to: DateTime<Utc>,
}

pub fn read_activity() -> PhantomTool<ReadActivity, ReadActivityResponse> {
    PhantomTool::new("ReadActivity")
}
