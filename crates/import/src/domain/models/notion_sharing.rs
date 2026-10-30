//! Who sees what a Notion workspace import writes, and what teammates
//! already imported.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// A teammate's copy of a Notion object, shared with the user's team.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotionAlreadyImported {
    /// The teammate who imported it, by email.
    pub by: String,
    /// The Macro entity it became.
    pub entity_id: String,
    /// That entity's type (`md`, `project`).
    pub entity_type: String,
}

/// Who a Notion workspace import shares what it writes with.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    JsonSchema,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum NotionSharing {
    /// Everything the import writes is shared with the user's team.
    Team,
    /// Everything stays visible to the user only.
    Personal,
    /// The decision model chooses per object.
    Ai,
}

/// What the owner changed in a plan before approving it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NotionWriteChoices {
    /// Plan rows left out of the import.
    pub excluded: Vec<Uuid>,
    /// Plan rows to share with the team although the plan keeps them.
    pub shared: Vec<Uuid>,
    /// Plan rows to keep visible only to the owner although the plan shares
    /// them.
    pub personal: Vec<Uuid>,
}

/// A teammate who already imported some of a plan's objects.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotionImporter {
    /// The teammate, by email.
    pub by: String,
    /// How many of the plan's objects they imported.
    pub count: u32,
}
