use anyhow::Context;
use sqlx::types::Uuid;
use sqlx::{Executor, Postgres};

/// deletes recipients for a given message
#[tracing::instrument(skip(executor), level = "info")]
pub async fn delete_message_recipients<'e, E>(executor: E, message_id: Uuid) -> anyhow::Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    let result = sqlx::query!(
        r#"DELETE FROM email_message_recipients WHERE message_id = $1"#,
        message_id
    )
    .execute(executor)
    .await
    .with_context(|| format!("Failed to delete recipients for message_id {}", message_id))?;

    let deleted_count = result.rows_affected();

    if deleted_count == 0 {
        tracing::warn!("No recipients found to delete for message");
    }

    Ok(())
}
