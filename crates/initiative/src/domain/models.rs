//! Domain models for initiatives.

#[cfg(test)]
mod test;

use std::fmt;
use std::str::FromStr;

use chrono::{DateTime, Utc};
#[cfg(feature = "ports")]
use entity_access::domain::models::AccessError;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::team_share::AuthorizedTeamShareCommand;
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Maximum initiative name length, counted in Unicode grapheme clusters.
pub const MAX_INITIATIVE_NAME_GRAPHEMES: usize = 100;

/// Maximum length of the create-time description prefill, counted in Unicode grapheme clusters.
pub const MAX_INITIATIVE_DESCRIPTION_GRAPHEMES: usize = 2_000;

/// Opaque identifier for an initiative. Minted as UUIDv7 in application code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(transparent)]
pub struct InitiativeId(Uuid);

impl InitiativeId {
    /// Mint a new UUIDv7 identifier.
    pub fn generate() -> Self {
        Self(Uuid::now_v7())
    }

    /// Wrap an already-persisted id.
    pub fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// The inner UUID.
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl fmt::Display for InitiativeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl FromStr for InitiativeId {
    type Err = uuid::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self(Uuid::parse_str(s)?))
    }
}

/// Minimal initiative identity used by access checks and internal lookups.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativeBasic {
    /// Opaque identifier.
    pub id: InitiativeId,
    /// Display name.
    pub name: String,
    /// Owner of the initiative.
    pub owner_id: MacroUserIdStr<'static>,
}

/// List-row view of an initiative.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativeSummary {
    /// Opaque identifier.
    pub id: InitiativeId,
    /// Display name.
    pub name: String,
    /// When the initiative was last updated.
    pub updated_at: DateTime<Utc>,
}

/// Full initiative returned to a caller, including members, tasks, and share state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativeDetail {
    /// Opaque identifier.
    pub id: InitiativeId,
    /// Display name.
    pub name: String,
    /// Owner of the initiative.
    pub owner_id: MacroUserIdStr<'static>,
    /// Member user ids. The owner is never stored here.
    pub member_ids: Vec<MacroUserIdStr<'static>>,
    /// Task ids currently assigned to the initiative.
    pub task_ids: Vec<String>,
    /// Current share permission.
    pub share_permission: SharePermissionV2,
    /// Caller's access level on this initiative.
    pub user_access_level: AccessLevel,
    /// When the initiative was created.
    pub created_at: DateTime<Utc>,
    /// When the initiative was last updated.
    pub updated_at: DateTime<Utc>,
}

/// A property value set on a new initiative as part of its create.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitialPropertyValue {
    /// Property definition to set.
    pub property_definition_id: Uuid,
    /// Value, validated by the properties service like any other property write.
    pub value: models_properties::api::requests::SetPropertyValue,
}

/// Create-initiative HTTP body.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CreateInitiativeRequest {
    /// Display name.
    pub name: String,
    /// Initial markdown for the description surface. Not stored on the initiative; later
    /// edits happen in the collaborative description editor.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Optional member user ids. Invalid ids fail at the service boundary.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub member_ids: Option<Vec<String>>,
    /// Share with the owner's team at create time. Defaults to true; users without
    /// a team create an unshared initiative. Explicit false skips the team grant.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub share_with_team: Option<bool>,
    /// Property values set as the owner within the create. A value the properties
    /// service rejects fails the whole create; no initiative is left behind.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub property_values: Vec<InitialPropertyValue>,
}

/// Update-initiative HTTP body. Absent fields are left unchanged. `member_ids`
/// present is a full replace. The description is edited in its collab surface, not here.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct UpdateInitiativeRequest {
    /// Replacement name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Full replacement collaborator list when present. Only the owner may send this field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub member_ids: Option<Vec<String>>,
    /// Share permission patch. Only the owner may send this field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub share_permission: Option<UpdateSharePermissionRequestV2>,
}

/// Accessible-initiative list.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativeList {
    /// Initiatives the caller can view.
    pub initiatives: Vec<InitiativeSummary>,
}

/// Arguments for creating an initiative row. No serde: repository-only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateInitiativeRepoArgs {
    /// App-generated identifier.
    pub id: InitiativeId,
    /// Owner / creator.
    pub owner_id: MacroUserIdStr<'static>,
    /// Validated name.
    pub name: String,
    /// Member ids with the owner removed and duplicates dropped.
    pub member_ids: Vec<MacroUserIdStr<'static>>,
}

/// Arguments for updating an initiative row. No serde: repository-only.
#[derive(Debug, Clone)]
pub struct UpdateInitiativeRepoArgs {
    /// Initiative to update.
    pub id: InitiativeId,
    /// Replacement name when present.
    pub name: Option<String>,
    /// Members to add when `member_ids` was present on the request.
    pub member_ids_added: Vec<MacroUserIdStr<'static>>,
    /// Members to remove when `member_ids` was present on the request.
    pub member_ids_removed: Vec<MacroUserIdStr<'static>>,
    /// Share permission patch when the owner sent one.
    pub share_permission: Option<UpdateSharePermissionRequestV2>,
    /// Authorized team-share write, if any.
    pub team_share: Option<AuthorizedTeamShareCommand>,
}

/// Errors returned by the initiative service.
#[derive(Debug, thiserror::Error)]
pub enum InitiativeError {
    /// The initiative does not exist.
    #[error("initiative not found")]
    NotFound,
    /// The caller cannot perform this action.
    #[error("unauthorized")]
    Unauthorized,
    /// The request was invalid.
    #[error("{0}")]
    BadRequest(String),
    /// The write conflicted with current state.
    #[error("{0}")]
    Conflict(String),
    /// The name exceeds the grapheme limit.
    #[error("name too long")]
    NameTooLong {
        /// Maximum allowed name length, in grapheme clusters.
        max: usize,
    },
    /// Any other internal error.
    #[error("internal initiative error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for InitiativeError {
    fn from(report: rootcause::Report) -> Self {
        InitiativeError::Internal(report)
    }
}

#[cfg(feature = "ports")]
impl From<AccessError> for InitiativeError {
    fn from(error: AccessError) -> Self {
        match error {
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
                Self::Unauthorized
            }
            AccessError::NotFound(_) => Self::NotFound,
            AccessError::BadRequest(message) => Self::BadRequest(message.to_string()),
            other => Self::Internal(rootcause::Report::new(other).into_dynamic()),
        }
    }
}
