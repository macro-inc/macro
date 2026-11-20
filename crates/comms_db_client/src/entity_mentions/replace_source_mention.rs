#[cfg(test)]
mod test;

use sqlx::PgPool;

use super::NewEntityMention;

/// Make `mention` the only entity the source `source_entity_type`/`source_entity_id` mentions.
///
/// Keeps an existing identical row (and its `created_at`), removes the source's other rows, and
/// serializes concurrent replaces of the same source so it never ends up with two.
#[tracing::instrument(err, skip(pool, user_id))]
pub async fn replace_source_mention(
    pool: &PgPool,
    source_entity_type: &str,
    source_entity_id: &str,
    user_id: Option<&str>,
    mention: &NewEntityMention,
) -> anyhow::Result<()> {
    let mut transaction = pool.begin().await?;
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended('comms_entity_mentions:' || $1::text || ':' || $2::text, 0))",
        source_entity_type,
        source_entity_id,
    )
    .execute(&mut *transaction)
    .await?;
    sqlx::query!(
        r#"
        DELETE FROM comms_entity_mentions
        WHERE source_entity_type = $1
          AND source_entity_id = $2
          AND (entity_type, entity_id) <> ($3, $4)
        "#,
        source_entity_type,
        source_entity_id,
        &mention.entity_type,
        &mention.entity_id,
    )
    .execute(&mut *transaction)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO comms_entity_mentions (id, source_entity_type, source_entity_id, entity_type, entity_id, user_id)
        SELECT $1::uuid, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::varchar
        WHERE NOT EXISTS (
            SELECT 1 FROM comms_entity_mentions
            WHERE source_entity_type = $2::varchar
              AND source_entity_id = $3::varchar
              AND entity_type = $4::varchar
              AND entity_id = $5::varchar
        )
        "#,
        macro_uuid::generate_uuid_v7(),
        source_entity_type,
        source_entity_id,
        &mention.entity_type,
        &mention.entity_id,
        user_id,
    )
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}
