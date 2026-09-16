use entity_access_db_utils::team_share::direct_level;
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareFacts, TeamShareGrant, TeamShareLevel,
};
use share_permission_db_utils::team_share::{self, TeamShareError};
use sqlx::{PgPool, Postgres, Transaction};

use crate::domain::models::{DocumentError, DocumentTeamShare};

// Existing repository operations retain their SQLx error type; conditional edits
// expose domain errors so authorization conflicts reach callers without becoming 500s.
impl From<sqlx::Error> for DocumentError {
    fn from(error: sqlx::Error) -> Self {
        Self::Internal(error.into())
    }
}

pub(super) fn map_team_share_error(error: rootcause::Report<TeamShareError>) -> DocumentError {
    match error.current_context() {
        TeamShareError::NotFound => DocumentError::NotFound("team-share document".to_string()),
        TeamShareError::ChangedFacts | TeamShareError::UntrackedGrant => {
            DocumentError::Conflict(error.to_string())
        }
        _ => DocumentError::Internal(error.into()),
    }
}

/// Read authoritative facts in one guarded snapshot, without creating permissions.
///
/// Documents shared before canonical state existed carry a direct grant for the
/// owner's team but a NULL level and revision zero. Those grants are adopted here so
/// the toggle reads as enabled and an owner's next update does not conflict.
#[tracing::instrument(err, skip(pool))]
pub async fn get_team_share_facts(
    pool: &PgPool,
    document_id: &str,
) -> Result<TeamShareFacts, DocumentError> {
    let entity = EntityType::Document.with_entity_str(document_id);
    let mut transaction = pool.begin().await?;
    let mut facts = team_share::load_facts(&mut transaction, &entity)
        .await
        .map_err(map_team_share_error)?;
    if let Some(legacy) = legacy_grant(&mut transaction, &facts).await? {
        team_share::adopt(&mut transaction, &facts, legacy)
            .await
            .map_err(map_team_share_error)?;
        facts = team_share::load_facts(&mut transaction, &entity)
            .await
            .map_err(map_team_share_error)?;
    }
    transaction.commit().await?;
    Ok(facts)
}

/// A historical direct grant for the owner's team on a document that canonical
/// sharing never touched. Inherited rows, foreign teams, and documents with any
/// revision history are not candidates; their untracked grants still conflict.
async fn legacy_grant(
    transaction: &mut Transaction<'_, Postgres>,
    facts: &TeamShareFacts,
) -> Result<Option<TeamShareGrant>, DocumentError> {
    if facts.current.is_some() || facts.revision != 0 {
        return Ok(None);
    }
    let Some(team_id) = facts.owner_team_id else {
        return Ok(None);
    };
    let document_id = document_uuid(&facts.entity)?;
    let level = direct_level(
        transaction.as_mut(),
        &document_id,
        EntityType::Document,
        team_id,
    )
    .await?;
    Ok(level
        .and_then(|level| TeamShareLevel::try_from(level).ok())
        .map(|level| TeamShareGrant { team_id, level }))
}

fn document_uuid(entity: &Entity<'_>) -> Result<uuid::Uuid, DocumentError> {
    uuid::Uuid::parse_str(&entity.entity_id)
        .map_err(|error| DocumentError::BadRequest(error.to_string()))
}

/// Read explicit state; inherited and untracked direct grants do not enable the toggle.
#[tracing::instrument(err, skip(pool))]
pub async fn get_team_share(
    pool: &PgPool,
    document_id: &str,
) -> Result<DocumentTeamShare, DocumentError> {
    let facts = get_team_share_facts(pool, document_id).await?;
    Ok(DocumentTeamShare {
        team_id: facts.owner_team_id,
        shared_with_team: facts.current.is_some(),
    })
}

/// Apply the canonical conditional update and commit before reporting success.
#[tracing::instrument(err, skip(pool))]
pub async fn set_team_share(
    pool: &PgPool,
    command: AuthorizedTeamShareCommand,
) -> Result<DocumentTeamShare, DocumentError> {
    if command.expected().entity.entity_type != EntityType::Document {
        return Err(DocumentError::BadRequest(
            "team-share command must target a document".to_string(),
        ));
    }
    let mut transaction = pool.begin().await?;
    team_share::apply(&mut transaction, &command)
        .await
        .map_err(map_team_share_error)?;
    transaction.commit().await?;
    Ok(DocumentTeamShare {
        team_id: command.expected().owner_team_id,
        shared_with_team: command.target().is_some(),
    })
}
