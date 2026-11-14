//! Policy for per-member CRM access, independent of mailbox contribution.

use super::model::{TeamError, TeamRole};

/// Validate roles read under the membership write lock. The repository holds
/// that lock through the update so concurrent promotions cannot cause lockout.
pub(crate) fn validate_change(
    actor: Option<TeamRole>,
    target: Option<TeamRole>,
    team_id: uuid::Uuid,
    enabled: bool,
) -> Result<(), TeamError> {
    if actor.is_none_or(|role| role < TeamRole::Admin) {
        return Err(TeamError::AccessError(
            entity_access::domain::models::AccessError::Unauthorized,
        ));
    }
    let target = target.ok_or(TeamError::TeamMemberNotFound(team_id))?;
    if !enabled && target != TeamRole::Member {
        return Err(TeamError::BadRequest(
            "admins and owners always retain CRM access".into(),
        ));
    }
    Ok(())
}
