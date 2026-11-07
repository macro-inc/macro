//! Canonical team-share persistence for calls.
//!
//! While a call is live, "share with team" is a pending intent on the active
//! `calls` row (`share_with_team`), toggled by participants. Archiving
//! translates that intent into the shared `SharePermission.team_share_*` state
//! and the `entity_access` team grant managed by `share_permission_db_utils`;
//! from then on the creator edits it through the canonical path. Active and
//! archived calls share one `SharePermission` row (and one call id), so the
//! same state serves both tables. This module only adapts the shared helpers
//! to the call repository's error type.

#[cfg(test)]
mod test;

use entity_access_db_utils::team_share::direct_level;
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareCreation, TeamShareFacts, TeamShareGrant, TeamShareLevel,
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

/// A direct View grant for the creator's team beside NULL canonical state.
/// That is what the previous archive code and `shareWithTeam` edits wrote,
/// including an old writer that re-inserted the row after a canonical clear.
/// Adopting it lets the creator's next edit succeed instead of conflicting
/// with an untracked grant. Grants at any other level are not adopted (calls
/// only share at View) and keep conflicting.
async fn legacy_view_grant(
    transaction: &mut Transaction<'_, Postgres>,
    call_id: &Uuid,
    facts: &TeamShareFacts,
) -> Result<Option<TeamShareGrant>, CallError> {
    if facts.current.is_some() {
        return Ok(None);
    }
    let Some(team_id) = facts.owner_team_id else {
        return Ok(None);
    };
    let level = direct_level(transaction.as_mut(), call_id, EntityType::Call, team_id).await?;
    Ok(
        (level == Some(AccessLevel::View)).then_some(TeamShareGrant {
            team_id,
            level: TeamShareLevel::View,
        }),
    )
}

/// Read the authoritative facts in one guarded snapshot, adopting a legacy
/// View grant for the creator's team first (see [`legacy_view_grant`]).
#[tracing::instrument(err, skip(pool))]
pub(super) async fn get_team_share_facts(
    pool: &PgPool,
    call_id: &Uuid,
) -> Result<TeamShareFacts, CallError> {
    let entity = call_entity(call_id);
    let mut transaction = pool.begin().await?;
    let mut facts = team_share::load_facts(&mut transaction, &entity)
        .await
        .map_err(|error| map_team_share_error(call_id, error))?;
    if let Some(legacy) = legacy_view_grant(&mut transaction, call_id, &facts).await? {
        team_share::adopt(&mut transaction, &facts, legacy)
            .await
            .map_err(|error| map_team_share_error(call_id, error))?;
        facts = team_share::load_facts(&mut transaction, &entity)
            .await
            .map_err(|error| map_team_share_error(call_id, error))?;
    }
    transaction.commit().await?;
    Ok(facts)
}

/// Translate the live `share_with_team` intent into canonical team sharing
/// while archiving, inside the archive transaction (which must already hold
/// the shared guard).
///
/// An intent of `true` grants View to the creator's current team, adopting a
/// legacy View grant an older archive left behind; a creator without a team
/// promises nothing. Canonical state that already exists (revision above zero)
/// is left alone: it was decided through the canonical path and outranks the
/// intent. A legacy grant at another level is left for review rather than
/// failing the archive.
#[tracing::instrument(err, skip(transaction))]
pub(super) async fn translate_live_share_with_team(
    transaction: &mut Transaction<'_, Postgres>,
    call_id: &Uuid,
    share_with_team: bool,
) -> Result<(), CallError> {
    let entity = call_entity(call_id);
    let facts = team_share::load_facts(transaction, &entity)
        .await
        .map_err(|error| map_team_share_error(call_id, error))?;
    if facts.current.is_some() || facts.revision != 0 || !share_with_team {
        return Ok(());
    }
    let Some(team_id) = facts.owner_team_id else {
        return Ok(());
    };
    match direct_level(transaction.as_mut(), call_id, EntityType::Call, team_id).await? {
        None => team_share::initialize(transaction, &entity, TeamShareCreation::Call)
            .await
            .map_err(|error| map_team_share_error(call_id, error)),
        Some(AccessLevel::View) => team_share::adopt(
            transaction,
            &facts,
            TeamShareGrant {
                team_id,
                level: TeamShareLevel::View,
            },
        )
        .await
        .map_err(|error| map_team_share_error(call_id, error)),
        Some(level) => {
            tracing::warn!(
                %call_id,
                %team_id,
                ?level,
                "archived call has an untracked team grant above view; leaving team sharing unset"
            );
            Ok(())
        }
    }
}

/// Apply the creator-authorized canonical team-share command inside the patch
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
