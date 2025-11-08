use sqlx::{Pool, Postgres};

/// Deletes the user document view location
#[tracing::instrument(skip(db))]
pub async fn delete_user_document_view_location(
    db: &Pool<Postgres>,
    user_id: &str,
    document_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM "UserDocumentViewLocation"
        WHERE user_id = $1 AND document_id = $2
        "#,
        user_id,
        document_id
    )
    .execute(db)
    .await?;
    Ok(())
}
