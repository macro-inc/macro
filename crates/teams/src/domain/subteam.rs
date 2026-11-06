//! Teams inside a workspace: named groups of workspace members, nested at
//! most one level. The workspace is the `team` row a user belongs to; these
//! are the teams people see in it ("Engineering", "Engineering / Platform").
//!
//! Anyone in the workspace may create a team and manages the teams they
//! create. A team's managers and the workspace's admins may rename, nest,
//! delete, and staff it. Members join open teams themselves and may always
//! leave.

use entity_access::domain::models::{AccessError, EntityAccessReceipt, MemberTeamRole};
use macro_user_id::user_id::MacroUserIdStr;

pub mod service;
#[cfg(test)]
mod test;

/// The longest a team name may be, in characters.
pub const SUBTEAM_NAME_MAX_CHARS: usize = 40;
/// The longest a team description may be, in characters.
pub const SUBTEAM_DESCRIPTION_MAX_CHARS: usize = 200;

/// The color of a team's mark.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "subteam_color", rename_all = "snake_case")
)]
#[serde(rename_all = "snake_case")]
pub enum SubteamColor {
    /// Violet.
    Violet,
    /// Blue.
    Blue,
    /// Teal.
    Teal,
    /// Cyan.
    Cyan,
    /// Orange.
    Orange,
    /// Pink.
    Pink,
    /// Lime.
    Lime,
}

/// Who may join a team without a manager adding them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "subteam_join_policy", rename_all = "snake_case")
)]
#[serde(rename_all = "snake_case")]
pub enum SubteamJoinPolicy {
    /// Anyone in the workspace may join.
    Open,
    /// Only managers add people.
    InviteOnly,
}

/// A member's role in a team.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "subteam_role", rename_all = "snake_case")
)]
#[serde(rename_all = "snake_case")]
pub enum SubteamRole {
    /// Belongs to the team.
    Member,
    /// Belongs to the team and manages it.
    Manager,
}

/// Someone on a team.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SubteamMember {
    /// The member's user id.
    #[cfg_attr(feature = "axum", schema(value_type = String))]
    pub user_id: MacroUserIdStr<'static>,
    /// The member's role in the team.
    pub role: SubteamRole,
}

/// A team in a workspace, with its members.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Subteam {
    /// The team's id.
    pub id: uuid::Uuid,
    /// The top-level team this one is nested in, if any.
    pub parent_id: Option<uuid::Uuid>,
    /// The team's name.
    pub name: String,
    /// What the team does. Empty when unset.
    pub description: String,
    /// The color of the team's mark.
    pub color: SubteamColor,
    /// Who may join without being added.
    pub join_policy: SubteamJoinPolicy,
    /// When the team was created.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// The team's members, managers first, then by when they joined.
    pub members: Vec<SubteamMember>,
}

impl Subteam {
    /// The role `user_id` holds in this team, if they are on it.
    pub fn role_of(&self, user_id: &MacroUserIdStr<'_>) -> Option<SubteamRole> {
        let user_id: &str = user_id.as_ref();

        self.members
            .iter()
            .find(|member| {
                let member_id: &str = member.user_id.as_ref();
                member_id == user_id
            })
            .map(|member| member.role)
    }
}

/// A validated team name: trimmed, non-empty, at most
/// [`SUBTEAM_NAME_MAX_CHARS`] characters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubteamName(String);

impl SubteamName {
    /// Trims and validates a team name.
    pub fn parse(name: &str) -> Result<Self, SubteamError> {
        let trimmed = name.trim();
        let length = trimmed.chars().count();

        if length == 0 || length > SUBTEAM_NAME_MAX_CHARS {
            return Err(SubteamError::InvalidName);
        }

        Ok(Self(trimmed.to_string()))
    }

    /// The name as stored.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A validated team description: trimmed, at most
/// [`SUBTEAM_DESCRIPTION_MAX_CHARS`] characters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubteamDescription(String);

impl SubteamDescription {
    /// Trims and validates a team description.
    pub fn parse(description: &str) -> Result<Self, SubteamError> {
        let trimmed = description.trim();

        if trimmed.chars().count() > SUBTEAM_DESCRIPTION_MAX_CHARS {
            return Err(SubteamError::DescriptionTooLong);
        }

        Ok(Self(trimmed.to_string()))
    }

    /// The description as stored.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A team to create.
#[derive(Debug, Clone)]
pub struct NewSubteam {
    /// The top-level team to nest the new team in, if any.
    pub parent_id: Option<uuid::Uuid>,
    /// The team's name.
    pub name: SubteamName,
    /// What the team does.
    pub description: SubteamDescription,
    /// The color of the team's mark.
    pub color: SubteamColor,
    /// Who may join without being added.
    pub join_policy: SubteamJoinPolicy,
}

/// Changes to a team's settings. Unset fields stay as they are.
#[derive(Debug, Clone, Default)]
pub struct SubteamPatch {
    /// The new name.
    pub name: Option<SubteamName>,
    /// The new description.
    pub description: Option<SubteamDescription>,
    /// The new color.
    pub color: Option<SubteamColor>,
    /// The new join policy.
    pub join_policy: Option<SubteamJoinPolicy>,
}

/// Why a team could not be nested where it was asked to go.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NestOutcome {
    /// The team now sits under the requested parent, or at the top.
    Nested,
    /// The team is not in the workspace.
    SubteamNotFound,
    /// The parent is not a top-level team in the workspace, or the team has
    /// teams of its own.
    InvalidParent,
}

/// What happened when a member was added or their role changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveMemberOutcome {
    /// The member is on the team with the requested role.
    Saved,
    /// The team is not in the workspace.
    SubteamNotFound,
    /// The user is not in the workspace.
    NotWorkspaceMember,
}

/// What happened when a team was created.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CreateSubteamOutcome {
    /// The new team.
    Created(Subteam),
    /// The parent is not a top-level team in the workspace.
    InvalidParent,
    /// Someone to add is not in the workspace.
    NotWorkspaceMember,
}

/// Errors from team operations.
#[derive(Debug, thiserror::Error)]
pub enum SubteamError {
    /// The team is not in the caller's workspace.
    #[error("the team does not exist")]
    NotFound,
    /// The caller does not manage the team and is not a workspace admin.
    #[error("only the team's managers and workspace admins may do this")]
    NotManager,
    /// The caller tried to join an invite-only team.
    #[error("this team is invite only")]
    InviteOnly,
    /// The name is empty or too long.
    #[error("team names must be 1 to {SUBTEAM_NAME_MAX_CHARS} characters")]
    InvalidName,
    /// The description is too long.
    #[error("team descriptions must be at most {SUBTEAM_DESCRIPTION_MAX_CHARS} characters")]
    DescriptionTooLong,
    /// The requested nesting would go deeper than one level.
    #[error(
        "teams nest one level: the parent must be a top-level team, and a team with teams of its own cannot be nested"
    )]
    InvalidParent,
    /// Someone to add is not in the workspace.
    #[error("only people in the workspace can be added to its teams")]
    NotWorkspaceMember,
    /// The caller's access could not be read from the receipt.
    #[error("access error")]
    AccessError(#[from] AccessError),
    /// The storage layer failed.
    #[error("storage layer error {0}")]
    StorageLayerError(#[from] anyhow::Error),
}

/// Persists a workspace's teams. Every method is scoped to the workspace
/// `team_id`, so a team id from another workspace reads as missing.
pub trait SubteamRepository: Clone + Send + Sync + 'static {
    /// The workspace's teams with their members, top-level teams first, then
    /// by name.
    fn list_subteams(
        &self,
        team_id: uuid::Uuid,
    ) -> impl Future<Output = anyhow::Result<Vec<Subteam>>> + Send;

    /// One of the workspace's teams with its members.
    fn get_subteam(
        &self,
        team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
    ) -> impl Future<Output = anyhow::Result<Option<Subteam>>> + Send;

    /// Creates a team with `manager_id` as its manager and `member_ids` as
    /// members, all or nothing.
    fn create_subteam(
        &self,
        team_id: uuid::Uuid,
        subteam: &NewSubteam,
        manager_id: &MacroUserIdStr<'_>,
        member_ids: &[MacroUserIdStr<'static>],
    ) -> impl Future<Output = anyhow::Result<CreateSubteamOutcome>> + Send;

    /// Applies `patch` to a team. Returns the updated team, or None when it
    /// is not in the workspace.
    fn update_subteam(
        &self,
        team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
        patch: &SubteamPatch,
    ) -> impl Future<Output = anyhow::Result<Option<Subteam>>> + Send;

    /// Moves a team under `parent_id`, or to the top level when None. The
    /// parent must be a top-level team and the team must have none of its own.
    fn nest_subteam(
        &self,
        team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
        parent_id: Option<uuid::Uuid>,
    ) -> impl Future<Output = anyhow::Result<NestOutcome>> + Send;

    /// Deletes a team; its nested teams move to the top level. Returns false
    /// when it was not in the workspace.
    fn delete_subteam(
        &self,
        team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
    ) -> impl Future<Output = anyhow::Result<bool>> + Send;

    /// Adds `user_id` to a team with `role`, or changes their role.
    fn save_subteam_member(
        &self,
        team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
        role: SubteamRole,
    ) -> impl Future<Output = anyhow::Result<SaveMemberOutcome>> + Send;

    /// Removes `user_id` from a team. Removing someone who is not on it is a
    /// no-op.
    fn remove_subteam_member(
        &self,
        team_id: uuid::Uuid,
        subteam_id: uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// The workspace teams use cases, for the caller's workspace.
pub trait SubteamService: Clone + Send + Sync + 'static {
    /// The workspace's teams with their members.
    fn list_subteams(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
    ) -> impl Future<Output = Result<Vec<Subteam>, SubteamError>> + Send;

    /// Creates a team managed by the caller, with `member_ids` as members.
    /// Nesting it under a team requires managing that team.
    fn create_subteam(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
        subteam: NewSubteam,
        member_ids: Vec<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<Subteam, SubteamError>> + Send;

    /// Changes a team's settings.
    fn update_subteam(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
        subteam_id: uuid::Uuid,
        patch: SubteamPatch,
    ) -> impl Future<Output = Result<Subteam, SubteamError>> + Send;

    /// Moves a team under another top-level team, or to the top level when
    /// `parent_id` is None. Requires managing the team and the new parent.
    fn nest_subteam(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
        subteam_id: uuid::Uuid,
        parent_id: Option<uuid::Uuid>,
    ) -> impl Future<Output = Result<Subteam, SubteamError>> + Send;

    /// Deletes a team. Its nested teams move to the top level.
    fn delete_subteam(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
        subteam_id: uuid::Uuid,
    ) -> impl Future<Output = Result<(), SubteamError>> + Send;

    /// Adds someone to a team or changes their role. Managers may add anyone
    /// in the workspace; anyone may join an open team as a member.
    fn save_subteam_member(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
        subteam_id: uuid::Uuid,
        user_id: MacroUserIdStr<'static>,
        role: SubteamRole,
    ) -> impl Future<Output = Result<Subteam, SubteamError>> + Send;

    /// Removes someone from a team. Anyone may leave; managers may remove
    /// anyone.
    fn remove_subteam_member(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
        subteam_id: uuid::Uuid,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Subteam, SubteamError>> + Send;
}
