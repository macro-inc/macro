//! Insert a new chat row.

use crate::domain::models::ChatAgentKind;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Postgres, Transaction};

/// Insert a new chat and return the generated chat ID.
#[tracing::instrument(err, skip(tx))]
pub(crate) async fn insert_chat(
    tx: &mut Transaction<'_, Postgres>,
    user_id: &MacroUserIdStr<'_>,
    name: &str,
    project_id: Option<&str>,
    kind: ChatAgentKind,
) -> anyhow::Result<String> {
    let row = sqlx::query_scalar!(
        r#"
        INSERT INTO "Chat" ("userId", name, "projectId", "agentKind")
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#,
        user_id.as_ref(),
        name,
        project_id,
        kind.as_str(),
    )
    .fetch_one(tx.as_mut())
    .await?;

    Ok(row)
}
