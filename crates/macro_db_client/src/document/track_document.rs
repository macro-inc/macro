use sqlx::{Postgres, Transaction};

/// Tracks a document view
#[tracing::instrument(skip(transaction))]
pub async fn track_document(
    transaction: &mut Transaction<'_, Postgres>,
    document_id: &str,
    user_id: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO "DocumentView" ("document_id", "user_id", "created_at")
        VALUES ($1, $2, NOW())
    "#,
        document_id,
        user_id
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}
