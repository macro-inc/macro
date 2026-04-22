use model_entity::EntityType;
use sqlx::{Postgres, Transaction};

/// Deletes all user access records for a specific item
#[tracing::instrument(skip(transaction))]
pub async fn delete_user_entity_access_by_item(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &uuid::Uuid,
    entity_type: EntityType,
) -> anyhow::Result<u64> {
    let result = sqlx::query!(
        r#"
        DELETE FROM "entity_access"
        WHERE "entity_id" = $1 AND "entity_type" = $2
        "#,
        entity_id,
        entity_type.as_ref(),
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(result.rows_affected())
}

#[tracing::instrument(skip(transaction))]
pub async fn delete_user_entity_access_bulk(
    transaction: &mut Transaction<'_, Postgres>,
    entity_ids: &[uuid::Uuid],
    entity_type: EntityType,
) -> anyhow::Result<u64> {
    if entity_ids.is_empty() {
        return Ok(0);
    }

    let result = match entity_type {
        EntityType::User | EntityType::Team | EntityType::Channel => {
            anyhow::bail!("invalid entity type")
        }
        EntityType::Project => {
            sqlx::query!(
                r#"
        DELETE FROM "entity_access"
        WHERE (entity_id = ANY($1) AND entity_type = $2)
        OR granted_from_project_id = ANY($3)
        "#,
                entity_ids,
                entity_type.as_ref(),
                &entity_ids
                    .iter()
                    .map(|p| p.to_string())
                    .collect::<Vec<String>>()
            )
            .execute(transaction.as_mut())
            .await?
        }
        EntityType::Chat | EntityType::Document | EntityType::EmailThread | EntityType::Call => {
            sqlx::query!(
                r#"
        DELETE FROM "entity_access"
        WHERE entity_id = ANY($1) AND entity_type = $2
        "#,
                entity_ids,
                entity_type.as_ref(),
            )
            .execute(transaction.as_mut())
            .await?
        }
    };

    Ok(result.rows_affected())
}
