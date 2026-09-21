//! Reading explicit channel grants for entities without a legacy share-policy row.

use super::AccessLevel;
use macro_uuid::Uuid;
use model_entity::EntityType;
use models_permissions::share_permission::channel_share_permission::ChannelSharePermission;
use sqlx::PgPool;

/// Return direct channel grants. Inherited project grants are intentionally separate.
pub async fn get_direct_channel_grants(
    pool: &PgPool,
    entity_id: &Uuid,
    entity_type: EntityType,
) -> Result<Vec<ChannelSharePermission>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"SELECT source_id AS channel_id, access_level AS "access_level: AccessLevel"
           FROM entity_access
           WHERE entity_id = $1 AND entity_type = $2 AND source_type = 'channel'
             AND granted_from_project_id IS NULL
           ORDER BY source_id"#,
        entity_id,
        entity_type.as_ref(),
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| ChannelSharePermission {
            channel_id: row.channel_id,
            access_level: row.access_level,
        })
        .collect())
}

/// Add a direct recipient without replacing an owner's explicit access choice.
pub async fn insert_direct_channel_grant_if_absent(
    pool: &PgPool,
    entity_id: &Uuid,
    entity_type: EntityType,
    channel_id: &Uuid,
    access_level: AccessLevel,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           VALUES ($1, $2, $3, 'channel', $4)
           ON CONFLICT (entity_id, entity_type, source_id, source_type)
           WHERE granted_from_project_id IS NULL DO NOTHING"#,
        entity_id,
        entity_type.as_ref(),
        channel_id.to_string(),
        access_level as _,
    )
    .execute(pool)
    .await?;
    Ok(())
}
