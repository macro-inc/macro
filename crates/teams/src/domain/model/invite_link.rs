//! Domain models for a team's shareable invite link.

use serde::{Deserialize, Serialize};

use super::{JoinTeamDirectlyError, TeamError, TeamMember};

/// The secret in a team's shareable invite link.
///
/// Anyone signed in who holds the token can join the team, so it is a random
/// value rather than a time-ordered id, and an admin resetting the link
/// replaces it.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "axum", schema(value_type = String))]
pub struct TeamInviteLinkToken(uuid::Uuid);

/// Redacted, so a token in a logged struct or error never reaches telemetry.
impl std::fmt::Debug for TeamInviteLinkToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TeamInviteLinkToken(<redacted>)")
    }
}

impl TeamInviteLinkToken {
    /// Generates a new unguessable token.
    pub fn generate() -> Self {
        // A secret, not an id: v4 carries 122 random bits where v7 leaks
        // creation time and has fewer.
        Self(uuid::Uuid::new_v4())
    }

    /// Wraps a token read from storage or a request path.
    pub fn from_uuid(token: uuid::Uuid) -> Self {
        Self(token)
    }

    /// The token as a UUID.
    pub fn as_uuid(&self) -> &uuid::Uuid {
        &self.0
    }
}

/// The team an invite link joins, shown before the user accepts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct TeamInviteLinkTeam {
    /// Id of the team the link joins.
    pub team_id: uuid::Uuid,
    /// Name of the team the link joins.
    pub team_name: String,
}

/// What happened when a user opened a team's invite link.
#[derive(Debug, Clone)]
pub enum JoinTeamByInviteLinkOutcome {
    /// The user joined the team.
    Joined(TeamMember<'static>),
    /// The user was already on the team, so nothing changed.
    AlreadyMember {
        /// The team the link joins.
        team_id: uuid::Uuid,
    },
}

impl JoinTeamByInviteLinkOutcome {
    /// The team the link joins.
    pub fn team_id(&self) -> uuid::Uuid {
        match self {
            Self::Joined(member) => member.team_id,
            Self::AlreadyMember { team_id } => *team_id,
        }
    }
}

/// Errors for reading or changing a team's invite link.
#[derive(Debug, thiserror::Error)]
pub enum ManageTeamInviteLinkError {
    /// The team only lets admins invite and the caller is not an admin.
    #[error("only team admins may invite users to this team")]
    NonAdminInvitesDisabled,
    /// Replacing an existing link breaks links already shared, so only admins
    /// may do it.
    #[error("only team admins may reset the team's invite link")]
    ResetRequiresAdmin,
    /// Underlying team error.
    #[error("Underlying team error {0}")]
    TeamError(#[from] TeamError),
}

/// Errors for joining a team through its invite link.
#[derive(Debug, thiserror::Error)]
pub enum JoinTeamByInviteLinkError {
    /// No team has this link: it never existed, was reset, or was turned off.
    #[error("this invite link is no longer valid")]
    LinkNotFound,
    /// Users belong to at most one team.
    #[error("you're already on another team")]
    AlreadyInAnotherTeam,
    /// Underlying team error.
    #[error("Underlying team error {0}")]
    TeamError(#[from] TeamError),
    /// Adding the user to the team failed.
    #[error("Underlying join error {0}")]
    JoinError(#[from] JoinTeamDirectlyError),
}
