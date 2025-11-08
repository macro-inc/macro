use anyhow::{Context, Result};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[tracing::instrument(skip(db))]
pub async fn add_reaction(
    db: &Pool<Postgres>,
    message_id: Uuid,
    emoji: String,
    user_id: String,
) -> Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO comms_reactions (message_id, emoji, user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
        "#,
        message_id,
        emoji,
        user_id,
    )
    .execute(db)
    .await
    .context("failed to add reaction")?;

    Ok(())
}
