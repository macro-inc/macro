use sqlx::{Executor, Postgres};

#[tracing::instrument(skip(executor))]
pub async fn delete_entity_mentions_by_source<'e, E>(
    executor: E,
    source_entity_id: Vec<String>,
) -> anyhow::Result<u64>
where
    E: Executor<'e, Database = Postgres>,
{
    let result = sqlx::query!(
        r#"
        DELETE FROM comms_entity_mentions
        WHERE source_entity_id = ANY($1)
        "#,
        &source_entity_id,
    )
    .execute(executor)
    .await?;

    Ok(result.rows_affected())
}
