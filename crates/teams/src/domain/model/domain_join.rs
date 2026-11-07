//! Domain models for joining the team that claims the user's email domain.

use serde::{Deserialize, Serialize};

use super::{JoinTeamDirectlyError, TeamError};

/// The team whose auto-join domain matches the user's email domain, offered
/// to the user before they accept.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct DomainTeam {
    /// Id of the team.
    pub team_id: uuid::Uuid,
    /// Name of the team.
    pub team_name: String,
}

/// Errors for joining the team that claims the user's email domain.
#[derive(Debug, thiserror::Error)]
pub enum JoinTeamByDomainError {
    /// No team lets people on the user's email domain join.
    #[error("no team is open to your email domain")]
    NoDomainTeam,
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
