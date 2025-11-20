/// Gets the entity name for the provided entity id and entity type
#[tracing::instrument(skip(db), err)]
pub async fn get_entity_name(
    db: &sqlx::PgPool,
    entity_id: &uuid::Uuid,
    entity_type: &str,
) -> anyhow::Result<Option<String>> {
    let name: Option<String> = match entity_type {
        "chats" => {
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
        "documents" => {
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
        "emails" => {
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
        "channels" => {
            sqlx::query!(
                r#"
                SELECT
                    c.name as "name?"
                FROM
                    "comms_channels" c
                WHERE
                    c.id = $1
                "#,
                entity_id,
            )
            .map(|row| row.name)
            .fetch_one(db)
            .await?
        }
        _ => {
            anyhow::bail!("entity type not supported");
        }
    };

    Ok(name)
}
