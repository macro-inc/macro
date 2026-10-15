use model_entity::EntityType;
use sqlx::{Postgres, Transaction};

/// Deletes all user access records for a specific item
#[tracing::instrument(skip(transaction))]
pub async fn delete_user_entity_access_by_item(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &uuid::Uuid,
    entity_type: EntityType,
) -> anyhow::Result<u64> {
    let rows = sqlx::query!(
        r#"
        DELETE FROM "entity_access"
        WHERE "entity_id" = $1 AND "entity_type" = $2
        RETURNING entity_type, entity_id::text AS "entity_id!"
        "#,
        entity_id,
        entity_type.as_ref(),
    )
    .map(|row| (row.entity_type, row.entity_id))
    .fetch_all(transaction.as_mut())
    .await?;

    source_items::sync_rows(transaction.as_mut(), &rows).await?;
    Ok(rows.len() as u64)
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

    let rows = match entity_type {
        EntityType::User
        | EntityType::Team
        | EntityType::Channel
        | EntityType::ChannelMessage
        | EntityType::CalendarEvent
        | EntityType::StaticFile
        | EntityType::CrmCompany
        | EntityType::CrmContact
        | EntityType::Skill
        | EntityType::ForeignEntity
        // Reminders, scheduled actions, and database rows own no
        // entity_access rows to delete.
        | EntityType::Reminder
        | EntityType::ScheduledAction
        | EntityType::DatabaseRow => {
            anyhow::bail!("invalid entity type")
        }
        EntityType::Project => {
            sqlx::query!(
                r#"
        DELETE FROM "entity_access"
        WHERE (entity_id = ANY($1) AND entity_type = $2)
        OR granted_from_project_id = ANY($3)
        RETURNING entity_type, entity_id::text AS "entity_id!"
        "#,
                entity_ids,
                entity_type.as_ref(),
                &entity_ids
                    .iter()
                    .map(|p| p.to_string())
                    .collect::<Vec<String>>()
            )
            .map(|row| (row.entity_type, row.entity_id))
            .fetch_all(transaction.as_mut())
            .await?
        }
        EntityType::Chat
        | EntityType::Document
        | EntityType::EmailThread
        | EntityType::Call
        | EntityType::AgentSession
        | EntityType::Initiative
        | EntityType::CrmPipeline
        | EntityType::Database
        | EntityType::Form => {
            sqlx::query!(
                r#"
        DELETE FROM "entity_access"
        WHERE entity_id = ANY($1) AND entity_type = $2
        RETURNING entity_type, entity_id::text AS "entity_id!"
        "#,
                entity_ids,
                entity_type.as_ref(),
            )
            .map(|row| (row.entity_type, row.entity_id))
            .fetch_all(transaction.as_mut())
            .await?
        }
    };

    source_items::sync_rows(transaction.as_mut(), &rows).await?;
    Ok(rows.len() as u64)
}
