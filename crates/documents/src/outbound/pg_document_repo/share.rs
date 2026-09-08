use entity_access_db_utils::AccessLevel;
use model_entity::EntityType;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareFacts,
};
use share_permission_db_utils::team_share::{self, TeamShareError};
use sqlx::PgPool;
use uuid::Uuid;

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

/// Share a newly created task with the given team (creation integration follows separately).
#[tracing::instrument(err, skip(pool))]
pub async fn share_with_team(
    pool: &PgPool,
    team_id: &Uuid,
    document_id: &str,
) -> Result<(), sqlx::Error> {
    let document_uuid = macro_uuid::string_to_uuid(document_id)
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;

    sqlx::query!(
        r#"
            INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
            VALUES ($1, 'document', $2, 'team', $3)
            ON CONFLICT DO NOTHING
        "#,
        &document_uuid,
        &team_id.to_string(),
        AccessLevel::Comment as _,
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Read authoritative facts in one guarded snapshot, without creating permissions.
#[tracing::instrument(err, skip(pool))]
pub async fn get_team_share_facts(
    pool: &PgPool,
    document_id: &str,
) -> Result<TeamShareFacts, DocumentError> {
    let mut transaction = pool.begin().await?;
    let facts = team_share::load_facts(
        &mut transaction,
        &EntityType::Document.with_entity_str(document_id),
    )
    .await
    .map_err(map_team_share_error)?;
    transaction.commit().await?;
    Ok(facts)
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
