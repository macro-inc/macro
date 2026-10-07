//! Direct channel grants that preserve an existing sharing choice.

use crate::{AccessLevel, EntityType};
use macro_uuid::Uuid;
use models_permissions::share_permission::channel_share_permission::ChannelSharePermission;
use sqlx::{PgPool, Postgres, Transaction};

/// Insert a direct channel grant only when one does not already exist.
///
/// Existing direct grants retain their exact level; project-inherited grants
/// remain separate. The caller owns authorization and commits the transaction.
#[tracing::instrument(skip(transaction), err)]
pub async fn insert_if_absent(
    transaction: &mut Transaction<'_, Postgres>,
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
    .execute(transaction.as_mut())
    .await?;
    Ok(())
}

/// Direct channel grants of an entity; project-inherited grants are not included.
#[tracing::instrument(skip(pool), err)]
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
