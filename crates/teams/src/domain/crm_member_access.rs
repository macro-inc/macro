//! Policy for per-member CRM access, independent of mailbox contribution.

use super::model::TeamError;
#[cfg(feature = "outbound")]
use super::model::TeamRole;
use std::{future::Future, pin::Pin};

/// Rollout check for changing preferences, independent of their enforcement.
pub trait CrmAccessRollout: std::fmt::Debug + Send + Sync + 'static {
    /// Refuse writes until all membership writers preserve the preference.
    fn require_enabled(&self) -> Pin<Box<dyn Future<Output = Result<(), TeamError>> + Send + '_>>;
}

/// Unwired services cannot introduce denials during a rolling deployment.
#[derive(Debug)]
pub struct DisabledCrmAccessRollout;

impl CrmAccessRollout for DisabledCrmAccessRollout {
    fn require_enabled(&self) -> Pin<Box<dyn Future<Output = Result<(), TeamError>> + Send + '_>> {
        Box::pin(async { Err(TeamError::CrmAccessChangesUnavailable) })
    }
}

/// Validate roles read under the membership write lock. The repository holds
/// that lock through the update so concurrent promotions cannot cause lockout.
/// Only the repository calls it, so it exists only where the repository does.
#[cfg(feature = "outbound")]
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
