use sqlx::{Pool, Postgres};

/// Copies a documents pdf specific parts. Such as document text extraction and pdf preprocess result.
#[tracing::instrument(skip(db))]
pub async fn copy_pdf_parts(
    db: Pool<Postgres>,
    new_document_id: &str,
    original_document_id: &str,
) -> anyhow::Result<()> {
    let mut transaction = db.begin().await?;

    // Copy Document Text Extraction
    tracing::trace!("copying document text extraction");
    sqlx::query!(
        r#"
        INSERT INTO "DocumentText" ("documentId", "content", "tokenCount")
        SELECT $1, content, "tokenCount" FROM "DocumentText"
        WHERE "documentId" = $2
    "#,
        new_document_id,
        original_document_id
    )
    .execute(transaction.as_mut())
    .await?;

    // Copy Document Preprocess Result
    tracing::trace!("copying document preprocess result");
    sqlx::query!(
        r#"
        INSERT INTO "DocumentProcessResult" ("documentId", "content", "jobType")
        SELECT $1, content, 'pdf_preprocess' FROM "DocumentProcessResult"
        WHERE "documentId" = $2 and "jobType" = 'pdf_preprocess'
        "#,
        new_document_id,
        original_document_id
    )
    .execute(transaction.as_mut())
    .await?;

    transaction.commit().await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_copy_pdf_parts(pool: Pool<Postgres>) -> anyhow::Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO "DocumentText" ("documentId", "content", "tokenCount")
            VALUES ('document-one', 'testing-content', 123)
                "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query!(
            r#"
            INSERT INTO "DocumentProcessResult" ("documentId", "content", "jobType")
            VALUES ('document-one', 'testing-content', 'pdf_preprocess')
                "#,
        )
        .execute(&pool)
        .await?;

        copy_pdf_parts(pool.clone(), "document-two", "document-one").await?;

        let document_text = sqlx::query!(
            r#"
            SELECT "content" FROM "DocumentText"
            WHERE "documentId" = 'document-two'
                "#,
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(document_text.content, "testing-content");

        let document_process_result = sqlx::query!(
            r#"
            SELECT "content" FROM "DocumentProcessResult"
            WHERE "documentId" = 'document-two' and "jobType" = 'pdf_preprocess'
                "#,
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(document_process_result.content, "testing-content");

        Ok(())
    }
}
