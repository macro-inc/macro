use sqlx::PgPool;

#[tracing::instrument(skip(db))]
pub async fn get_document_process_content_from_job_id(
    db: &PgPool,
    job_id: &str,
    document_id: &str,
) -> Result<String, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        SELECT
            d."content"
        FROM "DocumentProcessResult" d
        JOIN "JobToDocumentProcessResult" j ON d.id = j."documentProcessResultId"
        WHERE j."jobId" = $1 AND d."documentId" = $2
        "#,
        job_id,
        document_id,
    )
    .fetch_one(db)
    .await?;

    Ok(result.content)
}

#[tracing::instrument(skip(db))]
pub async fn get_document_process_content(
    db: &PgPool,
    document_id: &str,
    job_type: &str,
) -> Result<String, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        SELECT
            "content"
        FROM "DocumentProcessResult"
        WHERE "documentId" = $1 AND "jobType" = $2
        "#,
        document_id,
        job_type,
    )
    .fetch_one(db)
    .await?;

    Ok(result.content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("document_process_results")))]
    async fn test_get_document_process_content(pool: Pool<Postgres>) {
        // document doesn't exist
        let content = get_document_process_content(&pool, "document-one", "job-type")
            .await
            .unwrap();

        assert_eq!(content, "{\"exists\": true}");

        let not_exists = get_document_process_content(&pool, "document-two", "job-type").await;

        assert!(not_exists.is_err());
        assert_eq!(
            not_exists.err().unwrap().to_string(),
            "no rows returned by a query that expected to return at least one row"
        );
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("document_process_results")))]
    async fn test_get_document_process_content_from_job_id(pool: Pool<Postgres>) {
        // document doesn't exist
        let content = get_document_process_content_from_job_id(&pool, "job-one", "document-one")
            .await
            .unwrap();

        assert_eq!(content, "{\"exists\": true}");

        let job_not_exists =
            get_document_process_content_from_job_id(&pool, "job-two", "document-one").await;

        assert_eq!(
            job_not_exists.err().unwrap().to_string(),
            "no rows returned by a query that expected to return at least one row"
        );

        let sha_not_exists =
            get_document_process_content_from_job_id(&pool, "job-one", "document-bad").await;

        assert_eq!(
            sha_not_exists.err().unwrap().to_string(),
            "no rows returned by a query that expected to return at least one row"
        );
    }
}
