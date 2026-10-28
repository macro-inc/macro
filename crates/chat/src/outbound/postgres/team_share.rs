//! Canonical team-share persistence for chats.
//!
//! Chats reuse the shared `SharePermission.team_share_*` state and the
//! `entity_access` team grant managed by `share_permission_db_utils`; this
//! module only adapts those helpers to the chat repository's error type.

#[cfg(test)]
mod test;

use entity_access::domain::models::AccessError;
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareFacts,
};
use share_permission_db_utils::team_share::{self, TeamShareError};
use sqlx::{PgPool, Postgres, Transaction};

use crate::domain::models::ChatErr;

/// Map a canonical team-share failure onto the chat domain error.
///
/// Stale or unexplained state surfaces as a conflict so the owner can reload
/// and retry instead of receiving a 500.
pub(super) fn map_team_share_error(error: rootcause::Report<TeamShareError>) -> ChatErr {
    match error.current_context() {
        TeamShareError::NotFound => ChatErr::NotFound,
        TeamShareError::ChangedFacts | TeamShareError::UntrackedGrant => {
            ChatErr::Conflict(error.to_string())
        }
        TeamShareError::InvalidAdoption
        | TeamShareError::InvalidEntity
        | TeamShareError::InvalidState
        | TeamShareError::Infrastructure => ChatErr::Unknown(error.into()),
    }
}

fn chat_entity(chat_id: &str) -> Entity<'_> {
    EntityType::Chat.with_entity_str(chat_id)
}

/// Read the authoritative facts in one guarded snapshot without writing anything.
///
/// Chats never had a pre-canonical team grant, so unlike documents there is no
/// legacy adoption step here.
#[tracing::instrument(err, skip(pool))]
pub(super) async fn get_team_share_facts(
    pool: &PgPool,
    chat_id: &str,
) -> Result<TeamShareFacts, ChatErr> {
    let mut transaction = pool.begin().await.map_err(|e| ChatErr::Unknown(e.into()))?;
    let facts = team_share::load_facts(&mut transaction, &chat_entity(chat_id))
        .await
        .map_err(map_team_share_error)?;
    transaction
        .commit()
        .await
        .map_err(|e| ChatErr::Unknown(e.into()))?;
    Ok(facts)
}

/// Apply the owner-authorized team-share command inside the patch transaction,
/// or refuse a requested team level that arrived without one.
///
/// The command must target this chat and request exactly the level carried by
/// the share-permission patch; anything else is a malformed edit. Callers run
/// this before other `SharePermission` writes so the shared guard is acquired
/// before any row locks, matching the document repository.
#[tracing::instrument(err, skip(transaction, share_permission, team_share))]
pub(super) async fn apply_team_share(
    transaction: &mut Transaction<'_, Postgres>,
    chat_id: &str,
    share_permission: Option<&UpdateSharePermissionRequestV2>,
    team_share: Option<&AuthorizedTeamShareCommand>,
) -> Result<(), ChatErr> {
    let requested_level = share_permission.and_then(|p| p.team_share_access_level);
    match team_share {
        Some(command) => {
            let expected = &command.expected().entity;
            if expected.entity_type != EntityType::Chat
                || expected.entity_id != chat_id
                || requested_level != Some(command.target().map(|grant| grant.level.into()))
            {
                return Err(ChatErr::BadRequest(
                    "team-share command does not match patch".to_string(),
                ));
            }
            team_share::apply(transaction, command)
                .await
                .map_err(map_team_share_error)
        }
        None if requested_level.is_some() => Err(ChatErr::Access(AccessError::Unauthorized)),
        None => Ok(()),
    }
}
