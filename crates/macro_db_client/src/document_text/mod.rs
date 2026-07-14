use sqlx::{Pool, Postgres};

/// Gets the text from a document
#[tracing::instrument(skip(db))]
pub async fn get_document_text(
    db: &Pool<Postgres>,
    document_id: &str,
) -> Result<String, sqlx::Error> {
    let text = sqlx::query!(
        r#"
        SELECT content FROM "DocumentText" WHERE "documentId" = $1
        "#,
        document_id
    )
    .map(|row| row.content)
    .fetch_one(db)
    .await?;

    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("document_text")))]
    async fn test_get_document_text(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let document_text = get_document_text(&pool, "document-one").await?;
        assert_eq!(document_text, "test document text");
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("document_text")))]
    async fn test_get_document_text_no_exist(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let error = get_document_text(&pool, "document-two").await.unwrap_err();
        assert_eq!(error.to_string(), sqlx::Error::RowNotFound.to_string());
        Ok(())
    }
}
