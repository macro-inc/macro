use entity_access_db_utils::AccessLevel;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::DocumentTeamShare;

/// Share a document with the given team.
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

/// Resolve the document owner's team. Returns `None` when the owner does not
/// belong to a team.
async fn owner_team_id(pool: &PgPool, document_id: &str) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT tu.team_id
        FROM "Document" d
        JOIN team_user tu ON tu.user_id = d.owner
        WHERE d.id = $1
        LIMIT 1
        "#,
        document_id,
    )
    .fetch_optional(pool)
    .await
}

/// Get the team-share state of a document, resolved against the owner's team.
#[tracing::instrument(err, skip(pool))]
pub async fn get_team_share(
    pool: &PgPool,
    document_id: &str,
) -> Result<DocumentTeamShare, sqlx::Error> {
    let document_uuid = macro_uuid::string_to_uuid(document_id)
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;

    let Some(team_id) = owner_team_id(pool, document_id).await? else {
        return Ok(DocumentTeamShare {
            team_id: None,
            shared_with_team: false,
        });
    };

    let shared = sqlx::query_scalar!(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM entity_access
            WHERE entity_id = $1
              AND entity_type = 'document'
              AND source_id = $2
              AND source_type = 'team'
        ) as "exists!"
        "#,
        &document_uuid,
        &team_id.to_string(),
    )
    .fetch_one(pool)
    .await?;

    Ok(DocumentTeamShare {
        team_id: Some(team_id),
        shared_with_team: shared,
    })
}

/// Grant or revoke the document owner's team's access on the document.
///
/// Granting gives the team Edit access so teammates can collaboratively
/// maintain team snippets; revoking removes the team-source access row
/// (project-granted rows are left untouched). Returns the new state, or the
/// unshared state when the owner has no team.
#[tracing::instrument(err, skip(pool))]
pub async fn set_team_share(
    pool: &PgPool,
    document_id: &str,
    share: bool,
) -> Result<DocumentTeamShare, sqlx::Error> {
    let document_uuid = macro_uuid::string_to_uuid(document_id)
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;

    let Some(team_id) = owner_team_id(pool, document_id).await? else {
        return Ok(DocumentTeamShare {
            team_id: None,
            shared_with_team: false,
        });
    };

    if share {
        sqlx::query!(
            r#"
            INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
            VALUES ($1, 'document', $2, 'team', $3)
            ON CONFLICT (entity_id, entity_type, source_id, source_type)
                WHERE granted_from_project_id IS NULL
                DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = NOW()
            "#,
            &document_uuid,
            &team_id.to_string(),
            AccessLevel::Edit as _,
        )
        .execute(pool)
        .await?;
    } else {
        sqlx::query!(
            r#"
            DELETE FROM entity_access
            WHERE entity_id = $1
              AND entity_type = 'document'
              AND source_id = $2
              AND source_type = 'team'
              AND granted_from_project_id IS NULL
            "#,
            &document_uuid,
            &team_id.to_string(),
        )
        .execute(pool)
        .await?;
    }

    Ok(DocumentTeamShare {
        team_id: Some(team_id),
        shared_with_team: share,
    })
}
