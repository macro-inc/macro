use crate::model::ws::SelectModelPayload;
use ai::types::Model;
use anyhow::{Context as _, Result};
use macro_db_client::dcs::patch_chat::patch_chat;
use sqlx::PgPool;
use std::str::FromStr as _;

#[tracing::instrument(err, skip(db), fields(model=payload.model, chat_id=payload.chat_id))]
pub async fn select_model_handler(db: &PgPool, payload: SelectModelPayload) -> Result<()> {
    let new_model = Model::from_str(&payload.model).context("failed to parse model string")?;

    patch_chat(
        db,
        &payload.chat_id,
        None,
        None,
        Some(new_model.to_string().as_str()),
        None,
    )
    .await
    .context("failed to patch chat")?;

    Ok(())
}
