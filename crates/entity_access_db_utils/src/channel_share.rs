//! Direct channel grants that preserve an existing sharing choice.

use crate::{AccessLevel, EntityType};
use macro_uuid::Uuid;
use sqlx::{Postgres, Transaction};

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
