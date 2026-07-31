//! Look up what kind of agent backs a chat.

use crate::domain::models::ChatAgentKind;
use sqlx::PgPool;
use std::str::FromStr;

/// Returns the chat's `agentKind` column, parsed into [`ChatAgentKind`].
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_agent_kind(pool: &PgPool, chat_id: &str) -> anyhow::Result<ChatAgentKind> {
    let agent_kind = sqlx::query_scalar!(
        r#"
        SELECT "agentKind" FROM "Chat" WHERE id = $1
        "#,
        chat_id,
    )
    .fetch_one(pool)
    .await?;

    ChatAgentKind::from_str(&agent_kind).map_err(anyhow::Error::msg)
}
