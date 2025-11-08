use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn update_upload_job(
    db: Pool<Postgres>,
    document_id: &str,
    job_id: &str,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
        UPDATE "UploadJob" SET "documentId" = $1 WHERE "jobId" = $2;
        "#,
        document_id,
        job_id,
    )
    .execute(&db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(anyhow::anyhow!("jobId not found"));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_upload_job")))]
    async fn tes_update_upload_job(pool: Pool<Postgres>) {
        update_upload_job(pool.clone(), "document-one", "job-one")
            .await
            .unwrap();

        let result = sqlx::query!(
            r#"
            SELECT "documentId" FROM "UploadJob" WHERE "jobId" = $1
            "#,
            "job-one",
        )
        .fetch_one(&pool.clone())
        .await
        .unwrap();

        assert_eq!(result.documentId.unwrap(), "document-one".to_string());

        let result = update_upload_job(pool.clone(), "document-one", "job-none").await;

        assert_eq!(result.is_err(), true);

        assert_eq!(result.unwrap_err().to_string(), "jobId not found");
    }
}
