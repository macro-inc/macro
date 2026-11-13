//! The public projection of [`TeamTopicEvent`](super::TeamTopicEvent).
//!
//! Thin: ids, actors, roles and what changed. Routing fields (the DM
//! roster on joins, member lists on deletion) and billing never appear. Only
//! invite and auto-join events carry an email address or domain, and they go
//! to team admins only.

use macro_user_id::user_id::MacroUserIdStr;
use serde::Serialize;
use uuid::Uuid;

use super::{
    TeamAutoJoinDomainToggledMetadata, TeamCreatedMetadata, TeamDeletedMetadata,
    TeamInviteCreatedMetadata, TeamInviteRejectedMetadata, TeamInviteRevokedMetadata,
    TeamJoinMethod, TeamMemberJoinedMetadata, TeamMemberRemovedMetadata,
    TeamMemberRoleChangedMetadata, TeamUpdatedMetadata,
};
use crate::domain::model::TeamRole;

/// A public `macro.teams` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum TeamPublicEvent {
    /// A team was created.
    #[serde(rename = "team.created")]
    Created(TeamCreated),
    /// A team's name or slug changed.
    #[serde(rename = "team.updated")]
    Updated(TeamUpdated),
    /// A team was deleted.
    #[serde(rename = "team.deleted")]
    Deleted(TeamDeleted),
    /// An invitation was created. Admins only.
    #[serde(rename = "team.invite_created")]
    InviteCreated(TeamInviteCreated),
    /// An invitation was rejected. Admins only.
    #[serde(rename = "team.invite_rejected")]
    InviteRejected(TeamInviteResolved),
    /// An invitation was revoked. Admins only.
    #[serde(rename = "team.invite_revoked")]
    InviteRevoked(TeamInviteResolved),
    /// A user joined the team.
    #[serde(rename = "team.member_joined")]
    MemberJoined(TeamMemberJoined),
    /// A member was removed or left.
    #[serde(rename = "team.member_removed")]
    MemberRemoved(TeamMemberRemoved),
    /// A member's role changed.
    #[serde(rename = "team.member_role_changed")]
    MemberRoleChanged(TeamMemberRoleChanged),
    /// The automatic-join domain changed. Admins only.
    #[serde(rename = "team.auto_join_domain_toggled")]
    AutoJoinDomainToggled(TeamAutoJoinDomainToggled),
}

/// Public body of `team.created`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct TeamCreated {
    /// The team.
    pub team_id: Uuid,
    /// Display name.
    pub name: String,
    /// Stable slug.
    pub slug: String,
    /// The owning user.
    pub owner: MacroUserIdStr<'static>,
}

impl From<&TeamCreatedMetadata> for TeamCreated {
    fn from(metadata: &TeamCreatedMetadata) -> Self {
        Self {
            team_id: metadata.team_id,
            name: metadata.name.clone(),
            slug: metadata.slug.clone(),
            owner: metadata.owner.clone(),
        }
    }
}

/// Public body of `team.updated`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct TeamUpdated {
    /// The team.
    pub team_id: Uuid,
    /// Who updated it.
    pub actor: MacroUserIdStr<'static>,
    /// New display name, when it changed.
    pub name: Option<String>,
    /// New slug, when it changed.
    pub slug: Option<String>,
}

impl From<&TeamUpdatedMetadata> for TeamUpdated {
    fn from(metadata: &TeamUpdatedMetadata) -> Self {
        Self {
            team_id: metadata.team_id,
            actor: metadata.actor_user_id.clone(),
            name: metadata.name.clone(),
            slug: metadata.slug.clone(),
        }
    }
}

/// Public body of `team.deleted`: the team id only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct TeamDeleted {
    /// The deleted team.
    pub team_id: Uuid,
}

impl From<&TeamDeletedMetadata> for TeamDeleted {
    fn from(metadata: &TeamDeletedMetadata) -> Self {
        Self {
            team_id: metadata.team_id,
        }
    }
}

/// Public body of `team.invite_created`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct TeamInviteCreated {
    /// The team.
    pub team_id: Uuid,
    /// The invite.
    pub invite_id: Uuid,
    /// The invited email address.
    pub email: String,
    /// Who sent the invite.
    pub invited_by: MacroUserIdStr<'static>,
}

impl From<&TeamInviteCreatedMetadata> for TeamInviteCreated {
    fn from(metadata: &TeamInviteCreatedMetadata) -> Self {
        Self {
            team_id: metadata.team_id,
            invite_id: metadata.invite_id,
            email: metadata.email.clone(),
            invited_by: metadata.invited_by.clone(),
        }
    }
}

/// Public body of `team.invite_rejected` and `team.invite_revoked`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct TeamInviteResolved {
    /// The team.
    pub team_id: Uuid,
    /// The invite.
    pub invite_id: Uuid,
    /// The invited email address.
    pub email: String,
    /// The invitee who rejected it, or the admin who revoked it.
    pub actor: MacroUserIdStr<'static>,
}

impl From<&TeamInviteRejectedMetadata> for TeamInviteResolved {
    fn from(metadata: &TeamInviteRejectedMetadata) -> Self {
        Self {
            team_id: metadata.team_id,
            invite_id: metadata.invite_id,
            email: metadata.email.clone(),
            actor: metadata.actor_user_id.clone(),
        }
    }
}

impl From<&TeamInviteRevokedMetadata> for TeamInviteResolved {
    fn from(metadata: &TeamInviteRevokedMetadata) -> Self {
        Self {
            team_id: metadata.team_id,
            invite_id: metadata.invite_id,
            email: metadata.email.clone(),
            actor: metadata.actor_user_id.clone(),
        }
    }
}

/// How a member joined, without who invited them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum TeamJoinKind {
    /// They accepted an invitation.
    InviteAccepted,
    /// Their email matched the automatic-join domain.
    DomainAutoJoin,
    /// They opened the shareable invite link.
    InviteLink,
}

impl From<&TeamJoinMethod> for TeamJoinKind {
    fn from(method: &TeamJoinMethod) -> Self {
        match method {
            TeamJoinMethod::InviteAccepted { .. } => Self::InviteAccepted,
            TeamJoinMethod::DomainAutoJoin => Self::DomainAutoJoin,
            TeamJoinMethod::InviteLink => Self::InviteLink,
        }
    }
}

/// Public body of `team.member_joined`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct TeamMemberJoined {
    /// The team.
    pub team_id: Uuid,
    /// The new member.
    pub member_id: MacroUserIdStr<'static>,
    /// Their role.
    pub role: TeamRole,
    /// How they joined.
    pub join_method: TeamJoinKind,
}

impl From<&TeamMemberJoinedMetadata> for TeamMemberJoined {
    fn from(metadata: &TeamMemberJoinedMetadata) -> Self {
        Self {
            team_id: metadata.team_id,
            member_id: metadata.member_id.clone(),
            role: metadata.role,
            join_method: TeamJoinKind::from(&metadata.join_method),
        }
    }
}

/// Public body of `team.member_removed`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct TeamMemberRemoved {
    /// The team.
    pub team_id: Uuid,
    /// The removed member.
    pub member_id: MacroUserIdStr<'static>,
    /// Who removed them (themselves when they left).
    pub removed_by: MacroUserIdStr<'static>,
    /// Their role before removal.
    pub role: TeamRole,
}

impl From<&TeamMemberRemovedMetadata> for TeamMemberRemoved {
    fn from(metadata: &TeamMemberRemovedMetadata) -> Self {
        Self {
            team_id: metadata.team_id,
            member_id: metadata.member_id.clone(),
            removed_by: metadata.removed_by.clone(),
            role: metadata.role,
        }
    }
}

/// Public body of `team.member_role_changed`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct TeamMemberRoleChanged {
    /// The team.
    pub team_id: Uuid,
    /// Who changed the role.
    pub actor: MacroUserIdStr<'static>,
    /// The member whose role changed.
    pub member_id: MacroUserIdStr<'static>,
    /// New role.
    pub role: TeamRole,
    /// Previous role, when known.
    pub previous_role: Option<TeamRole>,
}

impl From<&TeamMemberRoleChangedMetadata> for TeamMemberRoleChanged {
    fn from(metadata: &TeamMemberRoleChangedMetadata) -> Self {
        Self {
            team_id: metadata.team_id,
            actor: metadata.actor_user_id.clone(),
            member_id: metadata.member_id.clone(),
            role: metadata.role,
            previous_role: metadata.previous_role,
        }
    }
}

/// Public body of `team.auto_join_domain_toggled`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct TeamAutoJoinDomainToggled {
    /// The team.
    pub team_id: Uuid,
    /// Who changed it.
    pub actor: MacroUserIdStr<'static>,
    /// The enabled domain; absent when disabled.
    pub auto_join_domain: Option<String>,
}

impl From<&TeamAutoJoinDomainToggledMetadata> for TeamAutoJoinDomainToggled {
    fn from(metadata: &TeamAutoJoinDomainToggledMetadata) -> Self {
        Self {
            team_id: metadata.team_id,
            actor: metadata.actor_user_id.clone(),
            auto_join_domain: metadata.auto_join_domain.clone(),
        }
    }
}
