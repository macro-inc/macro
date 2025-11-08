use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageOwner {
    pub sender_id: String,
}

#[tracing::instrument(skip(db))]
pub async fn get_message_owner(db: &Pool<Postgres>, message_id: &Uuid) -> Result<String> {
    let message = sqlx::query_as!(
        MessageOwner,
        r#"
        SELECT
            sender_id
        FROM comms_messages
        WHERE id = $1
        ORDER BY created_at ASC
        "#,
        message_id
    )
    .fetch_one(db)
    .await
    .context("unable to get messages")?;

    Ok(message.sender_id)
}
