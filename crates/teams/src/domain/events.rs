//! Kafka event models for the `macro.teams` topic.
//!
//! Event payloads deliberately exclude subscription, customer, Stripe, payment,
//! and other billing identifiers. Creation exposes only whether a team is paid.

#[cfg(test)]
mod test;

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroTeamsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::model::TeamRole;

/// Metadata for [`TeamTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamCreatedMetadata {
    /// Identifier of the created team.
    pub team_id: Uuid,
    /// Display name of the team.
    pub name: String,
    /// Stable team slug.
    pub slug: String,
    /// User who owns the team.
    pub owner: MacroUserIdStr<'static>,
    /// Whether the team has enterprise features.
    pub enterprise: bool,
    /// Whether the team has a paid subscription, without exposing billing identifiers.
    pub paid: bool,
    /// Corporate domain enabled for automatic joining, if any.
    pub auto_join_domain: Option<String>,
}

/// Metadata for [`TeamTopicEvent::Updated`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamUpdatedMetadata {
    /// Identifier of the updated team.
    pub team_id: Uuid,
    /// Authenticated user who updated the team.
    pub actor_user_id: MacroUserIdStr<'static>,
    /// Requested display name, or `None` when the PATCH omitted it.
    pub name: Option<String>,
    /// Requested slug, or `None` when the PATCH omitted it.
    pub slug: Option<String>,
}

/// Metadata for [`TeamTopicEvent::Deleted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamDeletedMetadata {
    /// Identifier of the deleted team.
    pub team_id: Uuid,
    /// Authenticated owner who deleted the team.
    pub actor_user_id: MacroUserIdStr<'static>,
    /// Users who belonged to the team when it was deleted.
    pub member_user_ids: Vec<MacroUserIdStr<'static>>,
}

/// Metadata for [`TeamTopicEvent::InviteCreated`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamInviteCreatedMetadata {
    /// Identifier of the team receiving the invite.
    pub team_id: Uuid,
    /// Identifier of the invite.
    pub invite_id: Uuid,
    /// Lowercase email address invited to the team.
    pub email: String,
    /// User who created the invite.
    pub invited_by: MacroUserIdStr<'static>,
    /// Team display name when it could be retrieved.
    pub team_name: Option<String>,
}

/// Metadata for [`TeamTopicEvent::InviteRejected`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamInviteRejectedMetadata {
    /// Identifier of the team associated with the invite.
    pub team_id: Uuid,
    /// Identifier of the rejected invite.
    pub invite_id: Uuid,
    /// Lowercase email address that rejected the invite.
    pub email: String,
    /// Invited user who rejected the invite.
    pub actor_user_id: MacroUserIdStr<'static>,
}

/// Metadata for [`TeamTopicEvent::InviteRevoked`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamInviteRevokedMetadata {
    /// Identifier of the team associated with the invite.
    pub team_id: Uuid,
    /// Identifier of the revoked invite.
    pub invite_id: Uuid,
    /// Lowercase email address whose invite was revoked.
    pub email: String,
    /// Authenticated administrator who revoked the invite.
    pub actor_user_id: MacroUserIdStr<'static>,
}

/// How a user joined a team.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TeamJoinMethod {
    /// The user accepted a team invitation.
    InviteAccepted {
        /// Identifier of the accepted invite.
        invite_id: Uuid,
        /// User who originally sent the invite.
        invited_by: MacroUserIdStr<'static>,
    },
    /// The user joined because their email matched the team's automatic-join domain.
    DomainAutoJoin,
}

/// Metadata for [`TeamTopicEvent::MemberJoined`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamMemberJoinedMetadata {
    /// Identifier of the joined team.
    pub team_id: Uuid,
    /// User who joined the team.
    pub member_id: MacroUserIdStr<'static>,
    /// Role assigned to the new member.
    pub role: TeamRole,
    /// Mechanism by which the member joined.
    pub join_method: TeamJoinMethod,
}

/// Metadata for [`TeamTopicEvent::MemberRemoved`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamMemberRemovedMetadata {
    /// Identifier of the team the member left.
    pub team_id: Uuid,
    /// User removed from the team.
    pub member_id: MacroUserIdStr<'static>,
    /// User who performed the removal.
    pub removed_by: MacroUserIdStr<'static>,
    /// Member's role before removal.
    pub role: TeamRole,
}

/// Metadata for [`TeamTopicEvent::MemberRoleChanged`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamMemberRoleChangedMetadata {
    /// Identifier of the team whose member changed role.
    pub team_id: Uuid,
    /// Authenticated user who changed the role.
    pub actor_user_id: MacroUserIdStr<'static>,
    /// User whose role changed.
    pub member_id: MacroUserIdStr<'static>,
    /// Newly assigned role.
    pub role: TeamRole,
    /// Role held before the change, when known.
    pub previous_role: Option<TeamRole>,
}

/// Metadata for [`TeamTopicEvent::AutoJoinDomainToggled`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamAutoJoinDomainToggledMetadata {
    /// Identifier of the team whose setting changed.
    pub team_id: Uuid,
    /// Authenticated user who changed the setting.
    pub actor_user_id: MacroUserIdStr<'static>,
    /// Newly enabled automatic-join domain, or `None` when disabled.
    pub auto_join_domain: Option<String>,
}

/// Lifecycle, invite, and membership events published to [`MacroTeamsTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum TeamTopicEvent {
    /// A team was created.
    #[serde(rename = "team.created")]
    Created(TeamCreatedMetadata),
    /// Team metadata was updated.
    #[serde(rename = "team.updated")]
    Updated(TeamUpdatedMetadata),
    /// A team was deleted.
    #[serde(rename = "team.deleted")]
    Deleted(TeamDeletedMetadata),
    /// A team invitation was created.
    #[serde(rename = "team.invite_created")]
    InviteCreated(TeamInviteCreatedMetadata),
    /// A team invitation was rejected by its recipient.
    #[serde(rename = "team.invite_rejected")]
    InviteRejected(TeamInviteRejectedMetadata),
    /// A team invitation was revoked by an administrator.
    #[serde(rename = "team.invite_revoked")]
    InviteRevoked(TeamInviteRevokedMetadata),
    /// A user joined a team.
    #[serde(rename = "team.member_joined")]
    MemberJoined(TeamMemberJoinedMetadata),
    /// A user was removed from a team.
    #[serde(rename = "team.member_removed")]
    MemberRemoved(TeamMemberRemovedMetadata),
    /// A team member's role changed.
    #[serde(rename = "team.member_role_changed")]
    MemberRoleChanged(TeamMemberRoleChangedMetadata),
    /// A team's automatic-join domain setting changed.
    #[serde(rename = "team.auto_join_domain_toggled")]
    AutoJoinDomainToggled(TeamAutoJoinDomainToggledMetadata),
}

impl TopicEvent for TeamTopicEvent {
    type Topic = MacroTeamsTopic;

    fn schema_version(&self) -> u8 {
        1
    }
}

/// Publishable event for [`MacroTeamsTopic`], keyed by the team's bare UUID.
pub struct TeamMacroEvent {
    key: String,
    event: Event<TeamTopicEvent>,
}

impl TeamMacroEvent {
    /// Build a team-created event.
    pub fn created(metadata: TeamCreatedMetadata) -> Self {
        Self::new(metadata.team_id, TeamTopicEvent::Created(metadata))
    }

    /// Build a team-updated event.
    pub fn updated(metadata: TeamUpdatedMetadata) -> Self {
        Self::new(metadata.team_id, TeamTopicEvent::Updated(metadata))
    }

    /// Build a team-deleted event.
    pub fn deleted(metadata: TeamDeletedMetadata) -> Self {
        Self::new(metadata.team_id, TeamTopicEvent::Deleted(metadata))
    }

    /// Build a team-invite-created event.
    pub fn invite_created(metadata: TeamInviteCreatedMetadata) -> Self {
        Self::new(metadata.team_id, TeamTopicEvent::InviteCreated(metadata))
    }

    /// Build a team-invite-rejected event.
    pub fn invite_rejected(metadata: TeamInviteRejectedMetadata) -> Self {
        Self::new(metadata.team_id, TeamTopicEvent::InviteRejected(metadata))
    }

    /// Build a team-invite-revoked event.
    pub fn invite_revoked(metadata: TeamInviteRevokedMetadata) -> Self {
        Self::new(metadata.team_id, TeamTopicEvent::InviteRevoked(metadata))
    }

    /// Build a team-member-joined event.
    pub fn member_joined(metadata: TeamMemberJoinedMetadata) -> Self {
        Self::new(metadata.team_id, TeamTopicEvent::MemberJoined(metadata))
    }

    /// Build a team-member-removed event.
    pub fn member_removed(metadata: TeamMemberRemovedMetadata) -> Self {
        Self::new(metadata.team_id, TeamTopicEvent::MemberRemoved(metadata))
    }

    /// Build a team-member-role-changed event.
    pub fn member_role_changed(metadata: TeamMemberRoleChangedMetadata) -> Self {
        Self::new(
            metadata.team_id,
            TeamTopicEvent::MemberRoleChanged(metadata),
        )
    }

    /// Build a team-auto-join-domain-toggled event.
    pub fn auto_join_domain_toggled(metadata: TeamAutoJoinDomainToggledMetadata) -> Self {
        Self::new(
            metadata.team_id,
            TeamTopicEvent::AutoJoinDomainToggled(metadata),
        )
    }

    fn new(team_id: Uuid, event: TeamTopicEvent) -> Self {
        Self::with_event(team_id.to_string(), Event::new(event))
    }

    fn with_event(key: String, event: Event<TeamTopicEvent>) -> Self {
        Self { key, event }
    }
}

impl MacroEvent for TeamMacroEvent {
    type EventPayload = TeamTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self::with_event(key, event)
    }
}
