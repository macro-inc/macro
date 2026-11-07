//! Shared team eligibility for complimentary seats and computers.

use super::{
    models::TeamAgentError,
    ports::{TeamAgentRepository, TeamMembership},
};
use uuid::Uuid;

/// Display reason persisted with complimentary computer purchases.
pub const INCLUDED_REASON: &str = "Included for Macro";

/// A verified current email of any owner or administrator can qualify a team.
/// The configured domain is exact; an empty value explicitly disables comps.
pub async fn is_included_team<R: TeamAgentRepository, M: TeamMembership>(
    repository: &R,
    membership: &M,
    team_id: Uuid,
    domain: &str,
) -> Result<bool, TeamAgentError> {
    if domain.is_empty() {
        return Ok(false);
    }
    for admin in membership.team_admins(team_id).await? {
        let email = repository
            .verified_email(&admin)
            .await
            .map_err(TeamAgentError::internal)?;
        if email
            .as_deref()
            .and_then(|email| email.rsplit_once('@'))
            .is_some_and(|(_, actual)| actual.eq_ignore_ascii_case(domain))
        {
            return Ok(true);
        }
    }
    Ok(false)
}
