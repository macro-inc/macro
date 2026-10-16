//! Facts used by sharing workflows across entity kinds.
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;

/// A member's role in the recorded owner's team.
#[derive(Debug, Clone, Copy, sqlx::Type)]
#[sqlx(type_name = "team_role", rename_all = "lowercase")]
pub enum SharingTeamRole {
    /// Ordinary member.
    Member,
    /// Team administrator.
    Admin,
    /// Team owner.
    Owner,
}
/// Ownership and display facts, loaded under the entity's lifecycle lock.
#[derive(Debug, Clone)]
pub struct SharingFacts {
    /// Recorded owner, never inferred from effective access.
    pub owner: Owner,
    /// User/team sponsor when the recorded owner is an owned bot.
    pub sponsor: Option<Owner>,
    /// Membership of the owner/sponsor team.
    pub team_members: Vec<(MacroUserIdStr<'static>, SharingTeamRole)>,
    /// Human-readable entity name.
    pub name: String,
    /// File extension for a document.
    pub file_type: Option<String>,
}
