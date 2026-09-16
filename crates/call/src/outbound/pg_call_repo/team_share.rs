//! Canonical team-share persistence for calls.
//!
//! Calls reuse the shared `SharePermission.team_share_*` state and the
//! `entity_access` team grant managed by `share_permission_db_utils`; this
//! module only adapts those helpers to the call repository's error type.
//! Active and archived calls share one `SharePermission` row (and one call
//! id), so the same state serves both tables.

#[cfg(test)]
mod test;

use model_entity::{Entity, EntityType};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareCreation, TeamShareFacts,
};
use share_permission_db_utils::team_share::{self, TeamShareError};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::domain::models::CallError;

// Repository operations that carry domain outcomes (conflicts, forbidden team
// levels) return `CallError`; plain database failures fold into `Internal`.
impl From<sqlx::Error> for CallError {
    fn from(error: sqlx::Error) -> Self {
        Self::Internal(error.into())
    }
}

/// Map a canonical team-share failure onto the call domain error.
///
/// Stale or unexplained state surfaces as a conflict so the creator can reload
/// and retry instead of receiving a 500.
pub(super) fn map_team_share_error(
    call_id: &Uuid,
    error: rootcause::Report<TeamShareError>,
) -> CallError {
    match error.current_context() {
        TeamShareError::NotFound => CallError::NotFound(call_id.to_string()),
        TeamShareError::ChangedFacts | TeamShareError::UntrackedGrant => {
            CallError::Conflict(error.to_string())
        }
        TeamShareError::InvalidAdoption
        | TeamShareError::InvalidEntity
        | TeamShareError::InvalidState
        | TeamShareError::Infrastructure => CallError::Internal(error.into()),
    }
}

fn call_entity(call_id: &Uuid) -> Entity<'static> {
    EntityType::Call.with_entity_string(call_id.to_string())
}

/// Read the authoritative facts in one guarded snapshot without writing anything.
///
/// Legacy `share_with_team` rows are reconciled by a data migration rather
/// than adopted lazily, so unlike documents there is no adoption step here.
#[tracing::instrument(err, skip(pool))]
pub(super) async fn get_team_share_facts(
    pool: &PgPool,
    call_id: &Uuid,
) -> Result<TeamShareFacts, CallError> {
    let mut transaction = pool.begin().await?;
    let facts = team_share::load_facts(&mut transaction, &call_entity(call_id))
        .await
        .map_err(|error| map_team_share_error(call_id, error))?;
    transaction.commit().await?;
    Ok(facts)
}

/// Initialize canonical sharing for a call inserted earlier in `transaction`:
/// `View` for the creator's current team, or nothing when they have no team.
///
/// The caller must already hold the shared guard (see `acquire_guard`), which
/// `initialize` re-acquires reentrantly.
#[tracing::instrument(err, skip(transaction))]
pub(super) async fn initialize_team_share(
    transaction: &mut Transaction<'_, Postgres>,
    call_id: &Uuid,
) -> Result<(), CallError> {
    team_share::initialize(transaction, &call_entity(call_id), TeamShareCreation::Call)
        .await
        .map_err(|error| map_team_share_error(call_id, error))
}

/// Apply the creator-authorized team-share command inside the patch
/// transaction, or refuse a requested team level that arrived without one.
///
/// The command must target this call, and when the share-permission patch
/// names a level it must be exactly the command's target; a command produced
/// from the legacy `shareWithTeam` alias carries no level in the patch.
/// Callers run this before other `SharePermission` writes so the shared guard
/// is acquired before any row locks, matching the chat and document repositories.
#[tracing::instrument(err, skip(transaction, share_permission, team_share))]
pub(super) async fn apply_team_share(
    transaction: &mut Transaction<'_, Postgres>,
    call_id: &Uuid,
    share_permission: Option<&UpdateSharePermissionRequestV2>,
    team_share: Option<&AuthorizedTeamShareCommand>,
) -> Result<(), CallError> {
    let requested_level = share_permission.and_then(|p| p.team_share_access_level);
    match team_share {
        Some(command) => {
            let expected = &command.expected().entity;
            let target_level = command.target().map(|grant| AccessLevel::from(grant.level));
            let level_matches = requested_level.is_none_or(|level| level == target_level);
            if expected.entity_type != EntityType::Call
                || expected.entity_id != call_id.to_string()
                || !level_matches
            {
                return Err(CallError::InvalidRequest(
                    "team-share command does not match patch".to_string(),
                ));
            }
            team_share::apply(transaction, command)
                .await
                .map_err(|error| map_team_share_error(call_id, error))
        }
        None if requested_level.is_some() => Err(CallError::Forbidden(
            "only the call's creator may change team sharing".to_string(),
        )),
        None => Ok(()),
    }
}
