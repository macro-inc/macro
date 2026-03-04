//! Patch a chat's metadata.

use sqlx::{Postgres, Transaction};

/// Update a chat's `updatedAt`, and optionally its `name` and `projectId`.
#[tracing::instrument(err, skip(tx))]
pub(crate) async fn patch_chat(
    tx: &mut Transaction<'_, Postgres>,
    chat_id: &str,
    name: Option<&str>,
    project_id: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"UPDATE "Chat" SET "updatedAt" = NOW() WHERE id = $1"#,
        chat_id,
    )
    .execute(tx.as_mut())
    .await?;

    if let Some(name) = name {
        sqlx::query!(
            r#"UPDATE "Chat" SET "name" = $1 WHERE id = $2"#,
            name,
            chat_id,
        )
        .execute(tx.as_mut())
        .await?;
    }

    if let Some(project_id) = project_id {
        if project_id.is_empty() {
            sqlx::query!(
                r#"UPDATE "Chat" SET "projectId" = NULL WHERE id = $1"#,
                chat_id,
            )
            .execute(tx.as_mut())
            .await?;
        } else {
            sqlx::query!(
                r#"UPDATE "Chat" SET "projectId" = $1 WHERE id = $2"#,
                project_id,
                chat_id,
            )
            .execute(tx.as_mut())
            .await?;
        }
    }

    Ok(())
}
