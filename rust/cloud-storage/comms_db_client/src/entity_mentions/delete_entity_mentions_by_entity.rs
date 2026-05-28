use anyhow::Result;
use sqlx::{Executor, Postgres};

#[tracing::instrument(skip(executor))]
pub async fn delete_entity_mentions_by_entity<'e, E>(
    executor: E,
    entity_ids: Vec<String>,
    source_entity_id: String,
) -> Result<u64>
where
    E: Executor<'e, Database = Postgres>,
{
    if entity_ids.is_empty() {
        return Ok(0);
    }

    let result = sqlx::query!(
        r#"
        DELETE FROM comms_entity_mentions
        WHERE entity_id = ANY($1) AND source_entity_id = $2
        "#,
        &entity_ids,
        source_entity_id,
    )
    .execute(executor)
    .await?;

    tracing::debug!(
        entity_ids=?entity_ids,
        source_entity_id=%source_entity_id,
        rows_affected=%result.rows_affected(),
        "Deleted entity mentions matching entity_ids and source_entity_id"
    );

    Ok(result.rows_affected())
}
