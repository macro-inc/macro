use models_opensearch::SearchEntityType;

/// Gets the entity name and macro user id of the owner for the provided
/// entity id and entity type
#[tracing::instrument(skip(db), err)]
pub async fn get_entity_name_and_owner(
    db: &sqlx::PgPool,
    entity_id: &uuid::Uuid,
    entity_type: &SearchEntityType,
) -> anyhow::Result<(Option<String>, String)> {
    let result: (Option<String>, String) = match entity_type {
        SearchEntityType::Chats => {
            sqlx::query!(
                r#"
                SELECT
                    c.name,
                    c."userId" as user_id
                FROM
                    "Chat" c
                WHERE
                    c.id = $1
                "#,
                &entity_id.to_string(),
            )
            .map(|row| (Some(row.name), row.user_id))
            .fetch_one(db)
            .await?
        }
        SearchEntityType::Documents => {
            sqlx::query!(
                r#"
                SELECT
                    d.name,
                    d.owner
                FROM
                    "Document" d
                WHERE
                    d.id = $1
                "#,
                &entity_id.to_string(),
            )
            .map(|row| (Some(row.name), row.owner))
            .fetch_one(db)
            .await?
        }
        SearchEntityType::Emails => {
            sqlx::query!(
                r#"
                SELECT
                    e.subject,
                    l.macro_id
                FROM
                    "email_messages" e
                JOIN email_links l ON l.id = e.link_id
                WHERE
                    e.thread_id = $1
                LIMIT 1
                "#,
                entity_id,
            )
            .map(|row| (row.subject, row.macro_id))
            .fetch_one(db)
            .await?
        }
        SearchEntityType::Channels => {
            sqlx::query!(
                r#"
                SELECT
                    c.name as "name?",
                    c.owner_id
                FROM
                    "comms_channels" c
                WHERE
                    c.id = $1
                "#,
                entity_id,
            )
            .map(|row| (row.name, row.owner_id))
            .fetch_one(db)
            .await?
        }
        _ => {
            anyhow::bail!("entity type not supported");
        }
    };

    Ok(result)
}

#[cfg(test)]
mod test;
