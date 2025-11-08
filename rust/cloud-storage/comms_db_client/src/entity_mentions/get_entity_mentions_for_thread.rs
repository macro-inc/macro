use crate::model::EntityMention;
use sqlx::{Executor, Postgres};
use uuid::Uuid;

/// This query finds all entity mentions where the source is a message
/// that is either the parent message of a thread OR a reply within that thread.
#[tracing::instrument(skip(executor))]
pub async fn get_entity_mentions_for_thread<'e, E>(
    executor: E,
    message_id: &Uuid,
) -> anyhow::Result<Vec<EntityMention>, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let mentions = sqlx::query_as!(
        EntityMention,
        r#"
        SELECT
            em.id,
            em.source_entity_type,
            em.source_entity_id,
            em.entity_type,
            em.entity_id,
            em.user_id,
            em.created_at
        FROM comms_entity_mentions AS em
        JOIN comms_messages AS m ON em.source_entity_id = m.id::text
        WHERE em.source_entity_type = 'message'
          AND (m.id = $1 OR m.thread_id = $1)
        ORDER BY em.created_at ASC
        "#,
        message_id,
    )
    .fetch_all(executor)
    .await?;

    Ok(mentions)
}
