use anyhow::{Context, Result};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::model::Reaction;

#[tracing::instrument(skip(db))]
pub async fn get_message_reactions(db: &Pool<Postgres>, message_id: Uuid) -> Result<Vec<Reaction>> {
    let reactions = sqlx::query_as!(
        Reaction,
        "SELECT * FROM comms_reactions WHERE message_id = $1",
        message_id
    )
    .fetch_all(db)
    .await
    .context("unable to fetch reactions")?;

    Ok(reactions)
}

#[tracing::instrument(skip(db))]
pub async fn get_messages_reactions(
    db: &Pool<Postgres>,
    message_ids: Vec<Uuid>,
) -> Result<Vec<Reaction>> {
    let reactions = sqlx::query_as!(
        Reaction,
        "SELECT * FROM comms_reactions WHERE message_id = ANY($1)",
        &message_ids
    )
    .fetch_all(db)
    .await
    .context("unable to fetch reactions")?;

    Ok(reactions)
}
