#[cfg(test)]
mod test;

use sqlx::{Executor, Postgres};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewEntityMention {
    pub entity_type: String,
    pub entity_id: String,
}

#[tracing::instrument(skip(executor, mentions), fields(mention_count = mentions.len()))]
pub async fn create_entity_mentions<'e, E>(
    executor: E,
    source_entity_type: &str,
    source_entity_id: &str,
    user_id: Option<&str>,
    mentions: &[NewEntityMention],
) -> anyhow::Result<u64>
where
    E: Executor<'e, Database = Postgres>,
{
    if mentions.is_empty() {
        return Ok(0);
    }

    let ids: Vec<uuid::Uuid> = mentions
        .iter()
        .map(|_| macro_uuid::generate_uuid_v7())
        .collect();
    let entity_types: Vec<String> = mentions
        .iter()
        .map(|mention| mention.entity_type.clone())
        .collect();
    let entity_ids: Vec<String> = mentions
        .iter()
        .map(|mention| mention.entity_id.clone())
        .collect();

    let source_entity_types: Vec<String> = vec![source_entity_type.to_string(); mentions.len()];
    let source_entity_ids: Vec<String> = vec![source_entity_id.to_string(); mentions.len()];
    let user_ids: Vec<Option<String>> = vec![user_id.map(str::to_string); mentions.len()];

    let result = sqlx::query!(
        r#"
        INSERT INTO comms_entity_mentions (id, source_entity_type, source_entity_id, entity_type, entity_id, user_id)
        SELECT * FROM UNNEST($1::uuid[], $2::varchar[], $3::varchar[], $4::varchar[], $5::varchar[], $6::varchar[])
        "#,
        &ids,
        &source_entity_types,
        &source_entity_ids,
        &entity_types,
        &entity_ids,
        &user_ids as &[Option<String>],
    )
    .execute(executor)
    .await?;

    Ok(result.rows_affected())
}
