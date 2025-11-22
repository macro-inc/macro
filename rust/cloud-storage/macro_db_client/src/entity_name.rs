use models_opensearch::SearchEntityType;

/// Gets the entity name for the provided entity id and entity type
#[tracing::instrument(skip(db), err)]
pub async fn get_entity_name(
    db: &sqlx::PgPool,
    entity_id: &uuid::Uuid,
    entity_type: &SearchEntityType,
) -> anyhow::Result<Option<String>> {
    let name: Option<String> = match entity_type {
        SearchEntityType::Chats => {
            sqlx::query!(
                r#"
                SELECT
                    c.name
                FROM
                    "Chat" c
                WHERE
                    c.id = $1
                "#,
                &entity_id.to_string(),
            )
            .map(|row| Some(row.name))
            .fetch_one(db)
            .await?
        }
        SearchEntityType::Documents => {
            sqlx::query!(
                r#"
                SELECT
                    d.name
                FROM
                    "Document" d
                WHERE
                    d.id = $1
                "#,
                &entity_id.to_string(),
            )
            .map(|row| Some(row.name))
            .fetch_one(db)
            .await?
        }
        SearchEntityType::Emails => {
            sqlx::query!(
                r#"
                SELECT
                    e.subject
                FROM
                    "email_messages" e
                WHERE
                    e.thread_id = $1
                LIMIT 1
                "#,
                entity_id,
            )
            .map(|row| row.subject)
            .fetch_one(db)
            .await?
        }
        _ => {
            anyhow::bail!("entity type not supported");
        }
    };

    Ok(name)
}

#[cfg(test)]
mod test;
