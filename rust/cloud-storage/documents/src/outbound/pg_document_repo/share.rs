use entity_access_db_utils::AccessLevel;
use sqlx::PgPool;
use uuid::Uuid;

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
