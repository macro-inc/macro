#[cfg(test)]
mod test;

use std::fmt::{Display, Formatter, Result as FmtResult};

use macro_user_id::user_id::MacroUserIdStr;
use models_entity_access_management::EntityAccessSourceType;
use serde::Serialize;
use uuid::Uuid;

use super::{AccessLevel, Entity, EntityPermission, ParticipantRole, TeamRole};

/// Every matching grant path for a user on one entity, plus the strongest
/// permission those grants imply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AccessExplanation {
    /// The user whose access was explained.
    pub user_id: MacroUserIdStr<'static>,
    /// The entity that was queried.
    pub entity: Entity,
    /// The strongest permission implied by [`Self::grants`].
    ///
    /// `None` when no grant matched. That is a successful answer, not an error.
    pub effective: Option<EntityPermission>,
    /// Every grant path that matched. Empty means the user has no access.
    pub grants: Vec<AccessGrant>,
}

impl AccessExplanation {
    /// Build an explanation from already-resolved grants.
    pub fn from_grants(
        user_id: MacroUserIdStr<'static>,
        entity: Entity,
        grants: Vec<AccessGrant>,
    ) -> Self {
        let effective = strongest_permission(&grants);
        Self {
            user_id,
            entity,
            effective,
            grants,
        }
    }

    /// The effective access level when the permission is item-shaped.
    pub fn effective_access_level(&self) -> Option<AccessLevel> {
        match self.effective {
            Some(EntityPermission::AccessLevel { access_level }) => Some(access_level),
            _ => None,
        }
    }
}

impl Display for AccessExplanation {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        writeln!(f, "user: {}", self.user_id)?;
        writeln!(
            f,
            "entity: {} / {}",
            self.entity.entity_type, self.entity.entity_id
        )?;
        match self.effective {
            Some(permission) => writeln!(f, "effective: {}", format_permission(&permission))?,
            None => writeln!(f, "effective: none")?,
        }
        writeln!(f)?;
        if self.grants.is_empty() {
            writeln!(f, "grants: none")?;
        } else {
            writeln!(f, "grants:")?;
            for grant in &self.grants {
                writeln!(f, "  - {grant}")?;
            }
        }
        Ok(())
    }
}

/// Why a document is reachable through an attached email thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EmailAttachmentReason {
    /// The caller owns the attached thread's inbox.
    InboxOwner,
    /// The caller is delegated the attached thread's inbox.
    InboxDelegate,
    /// The caller has an `entity_access` row on the attached thread.
    ThreadGrant,
}

impl EmailAttachmentReason {
    fn access_level(self) -> AccessLevel {
        match self {
            Self::InboxOwner | Self::InboxDelegate => AccessLevel::Edit,
            Self::ThreadGrant => AccessLevel::View,
        }
    }

    fn parse_db(value: &str) -> Option<Self> {
        match value {
            "inbox_owner" => Some(Self::InboxOwner),
            "inbox_delegate" => Some(Self::InboxDelegate),
            "thread_grant" => Some(Self::ThreadGrant),
            _ => None,
        }
    }
}

impl Display for EmailAttachmentReason {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        f.write_str(match self {
            Self::InboxOwner => "inbox_owner",
            Self::InboxDelegate => "inbox_delegate",
            Self::ThreadGrant => "thread_grant",
        })
    }
}

/// Principal kind stored on a foreign entity row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ForeignEntityAuthEntity {
    /// Stored for a user.
    User,
    /// Stored for a team.
    Team,
}

impl ForeignEntityAuthEntity {
    /// Wire value stored in `foreign_entity.stored_for_auth_entity`.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Team => "team",
        }
    }

    fn parse_db(value: &str) -> Option<Self> {
        match value {
            "user" => Some(Self::User),
            "team" => Some(Self::Team),
            _ => None,
        }
    }
}

impl Display for ForeignEntityAuthEntity {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        f.write_str(self.as_str())
    }
}

/// One concrete path that grants a user access to an entity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AccessGrant {
    /// A matching `entity_access` row.
    EntityAccess {
        /// Who the row was granted to.
        source_type: EntityAccessSourceType,
        /// User id, channel id, or team id.
        source_id: String,
        /// Level stored on the row.
        access_level: AccessLevel,
        /// Present when the row was copied from a parent project share.
        granted_from_project_id: Option<String>,
    },
    /// `SharePermission` with `linkShare = PUBLIC`.
    PublicLink {
        /// Level on the public link.
        access_level: AccessLevel,
    },
    /// `SharePermission` with `linkShare = TEAM`, via the owner's team.
    TeamLink {
        /// Level on the team link.
        access_level: AccessLevel,
        /// The owner's team that matched the caller's source ids.
        owner_team_id: Uuid,
    },
    /// The caller owns the email thread's inbox.
    InboxOwner,
    /// The caller is the primary on a delegated inbox.
    InboxDelegate {
        /// The mailbox owner whose inbox was delegated.
        mailbox_owner: MacroUserIdStr<'static>,
    },
    /// The thread's containing project has an `entity_access` row for the caller.
    ContainingProject {
        /// The project that granted View.
        project_id: String,
    },
    /// A document reachable because it is attached to a thread the caller can see.
    EmailAttachmentThread {
        /// The linked email thread.
        thread_id: Uuid,
        /// Which thread path produced this grant.
        reason: EmailAttachmentReason,
    },
    /// CRM access via membership on the entity's owning team.
    CrmTeam {
        /// The team that owns the CRM row.
        team_id: Uuid,
        /// The caller's role on that team.
        team_role: TeamRole,
        /// Mapped access level after hidden-row rules.
        access_level: AccessLevel,
    },
    /// An active channel participant row.
    ChannelParticipant {
        /// Stored participant role.
        role: ParticipantRole,
    },
    /// A public channel with no participant row defaults to Member.
    ChannelPublicDefault,
    /// A team channel visible because the caller is on the owning team.
    ChannelTeamViewOnly {
        /// The channel's owning team.
        team_id: Uuid,
    },
    /// Direct `team_user` membership on the requested team.
    TeamMembership {
        /// Role on that team.
        role: TeamRole,
    },
    /// The caller set the reminder.
    ReminderOwner,
    /// The caller owns the calendar event.
    CalendarOwner,
    /// The caller is delegated the event's source inbox.
    CalendarInboxDelegate,
    /// A foreign entity stored for a matching source pair.
    ForeignEntity {
        /// The stored-for principal.
        stored_for_id: String,
        /// User or team.
        stored_for_auth_entity: ForeignEntityAuthEntity,
    },
    /// Current static-file policy. Every caller gets View.
    StaticFileAlwaysView,
}

impl AccessGrant {
    /// The permission this grant confers by itself.
    pub fn permission(&self) -> EntityPermission {
        match self {
            Self::EntityAccess { access_level, .. }
            | Self::PublicLink { access_level }
            | Self::TeamLink { access_level, .. }
            | Self::CrmTeam { access_level, .. } => EntityPermission::AccessLevel {
                access_level: *access_level,
            },
            Self::ContainingProject { .. } => EntityPermission::AccessLevel {
                access_level: AccessLevel::View,
            },
            Self::EmailAttachmentThread { reason, .. } => EntityPermission::AccessLevel {
                access_level: reason.access_level(),
            },
            Self::InboxOwner | Self::ReminderOwner | Self::CalendarOwner => {
                EntityPermission::AccessLevel {
                    access_level: AccessLevel::Owner,
                }
            }
            Self::InboxDelegate { .. } => EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            },
            Self::CalendarInboxDelegate => EntityPermission::AccessLevel {
                access_level: AccessLevel::Edit,
            },
            Self::StaticFileAlwaysView | Self::ForeignEntity { .. } => {
                EntityPermission::AccessLevel {
                    access_level: AccessLevel::View,
                }
            }
            Self::ChannelParticipant { role } => EntityPermission::ChannelRole { role: *role },
            Self::ChannelPublicDefault => EntityPermission::ChannelRole {
                role: ParticipantRole::Member,
            },
            Self::ChannelTeamViewOnly { .. } => EntityPermission::ChannelViewOnly,
            Self::TeamMembership { role } => EntityPermission::TeamRole { role: *role },
        }
    }

    pub(crate) fn email_attachment_reason(value: &str) -> Option<EmailAttachmentReason> {
        EmailAttachmentReason::parse_db(value)
    }

    pub(crate) fn foreign_entity_auth(value: &str) -> Option<ForeignEntityAuthEntity> {
        ForeignEntityAuthEntity::parse_db(value)
    }
}

impl Display for AccessGrant {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        match self {
            Self::EntityAccess {
                source_type,
                source_id,
                access_level,
                granted_from_project_id,
            } => {
                write!(
                    f,
                    "entity_access {} {source_id} {access_level}",
                    format_source_type(*source_type)
                )?;
                if let Some(project_id) = granted_from_project_id {
                    write!(f, " granted_from_project {project_id}")?;
                }
                Ok(())
            }
            Self::PublicLink { access_level } => write!(f, "public_link {access_level}"),
            Self::TeamLink {
                access_level,
                owner_team_id,
            } => write!(f, "team_link {owner_team_id} {access_level}"),
            Self::InboxOwner => write!(f, "inbox_owner"),
            Self::InboxDelegate { mailbox_owner } => {
                write!(f, "inbox_delegate mailbox={mailbox_owner}")
            }
            Self::ContainingProject { project_id } => {
                write!(f, "containing_project {project_id}")
            }
            Self::EmailAttachmentThread { thread_id, reason } => {
                write!(f, "email_attachment_thread {thread_id} {reason}")
            }
            Self::CrmTeam {
                team_id,
                team_role,
                access_level,
            } => write!(
                f,
                "crm_team {team_id} role={} {access_level}",
                format_team_role(*team_role)
            ),
            Self::ChannelParticipant { role } => {
                write!(f, "channel_participant {}", format_participant_role(*role))
            }
            Self::ChannelPublicDefault => write!(f, "channel_public_default"),
            Self::ChannelTeamViewOnly { team_id } => {
                write!(f, "channel_team_view_only {team_id}")
            }
            Self::TeamMembership { role } => {
                write!(f, "team_membership {}", format_team_role(*role))
            }
            Self::ReminderOwner => write!(f, "reminder_owner"),
            Self::CalendarOwner => write!(f, "calendar_owner"),
            Self::CalendarInboxDelegate => write!(f, "calendar_inbox_delegate"),
            Self::ForeignEntity {
                stored_for_id,
                stored_for_auth_entity,
            } => write!(
                f,
                "foreign_entity stored_for={stored_for_id} auth={stored_for_auth_entity}"
            ),
            Self::StaticFileAlwaysView => write!(f, "static_file_always_view"),
        }
    }
}

fn strongest_permission(grants: &[AccessGrant]) -> Option<EntityPermission> {
    grants
        .iter()
        .map(AccessGrant::permission)
        .reduce(stronger_permission)
}

fn stronger_permission(left: EntityPermission, right: EntityPermission) -> EntityPermission {
    match (left, right) {
        (
            EntityPermission::AccessLevel { access_level: left },
            EntityPermission::AccessLevel {
                access_level: right,
            },
        ) => EntityPermission::AccessLevel {
            access_level: left.max(right),
        },
        (EntityPermission::TeamRole { role: left }, EntityPermission::TeamRole { role: right }) => {
            EntityPermission::TeamRole {
                role: left.max(right),
            }
        }
        (
            EntityPermission::ChannelRole { role: left },
            EntityPermission::ChannelRole { role: right },
        ) => EntityPermission::ChannelRole {
            role: stronger_participant_role(left, right),
        },
        (EntityPermission::ChannelViewOnly, other @ EntityPermission::ChannelRole { .. })
        | (other @ EntityPermission::ChannelRole { .. }, EntityPermission::ChannelViewOnly) => {
            other
        }
        (EntityPermission::ChannelViewOnly, EntityPermission::ChannelViewOnly) => {
            EntityPermission::ChannelViewOnly
        }
        (left, _) => left,
    }
}

fn stronger_participant_role(left: ParticipantRole, right: ParticipantRole) -> ParticipantRole {
    if participant_rank(left) >= participant_rank(right) {
        left
    } else {
        right
    }
}

fn participant_rank(role: ParticipantRole) -> u8 {
    match role {
        ParticipantRole::Member => 1,
        ParticipantRole::Admin => 2,
        ParticipantRole::Owner => 3,
    }
}

fn format_permission(permission: &EntityPermission) -> String {
    match permission {
        EntityPermission::AccessLevel { access_level } => access_level.to_string(),
        EntityPermission::ChannelViewOnly => "channel_view_only".to_string(),
        EntityPermission::ChannelRole { role } => {
            format!("channel_{}", format_participant_role(*role))
        }
        EntityPermission::TeamRole { role } => format!("team_{}", format_team_role(*role)),
    }
}

fn format_source_type(source_type: EntityAccessSourceType) -> &'static str {
    match source_type {
        EntityAccessSourceType::User => "user",
        EntityAccessSourceType::Channel => "channel",
        EntityAccessSourceType::Team => "team",
    }
}

fn format_team_role(role: TeamRole) -> &'static str {
    match role {
        TeamRole::Member => "member",
        TeamRole::Admin => "admin",
        TeamRole::Owner => "owner",
    }
}

fn format_participant_role(role: ParticipantRole) -> &'static str {
    match role {
        ParticipantRole::Member => "member",
        ParticipantRole::Admin => "admin",
        ParticipantRole::Owner => "owner",
    }
}
