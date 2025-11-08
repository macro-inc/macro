use anyhow::{Context, Result};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[tracing::instrument(skip(db))]
pub async fn remove_reaction(
    db: &Pool<Postgres>,
    message_id: Uuid,
    emoji: String,
    user_id: String,
) -> Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM comms_reactions
        WHERE message_id = $1 AND emoji = $2 AND user_id = $3
        "#,
        message_id,
        emoji,
        user_id,
    )
    .execute(db)
    .await
    .context("failed to remove reaction")?;

    Ok(())
}
