use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn update_document(db: &Pool<Postgres>, document_id: &str) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE "Document"
        SET "updatedAt" = NOW()
        WHERE id = $1
        "#,
        document_id
    )
    .execute(db)
    .await?;

    Ok(())
}
