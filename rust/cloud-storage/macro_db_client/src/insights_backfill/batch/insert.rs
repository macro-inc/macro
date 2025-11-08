use anyhow::Result;
use sqlx::PgPool;

pub async fn create_insights_backfill_batch_with_id(
    pool: &PgPool,
    batch_id: &str,
    job_id: &str,
    thread_ids: &[String],
    sqs_message_id: Option<&str>,
) -> Result<()> {
    let total_threads = thread_ids.len() as i32;

    sqlx::query!(
        r#"
        INSERT INTO "EmailInsightsBackfillBatch" (
            id, 
            "insightsBackfillJobId", 
            "sqsMessageId",
            "threadIds", 
            "totalThreads", 
            status,
            "queuedAt",
            "createdAt",
            "updatedAt"
        ) VALUES (
            $1, $2, $3, $4, $5, 'Queued'::"insights_backfill_batch_status", NOW(), NOW(), NOW()
        )
        "#,
        batch_id,
        job_id,
        sqs_message_id,
        thread_ids,
        total_threads,
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod insight_backfill_tests {
    use super::*;
    use crate::insights_backfill::batch::get::get_insights_backfill_batch_by_id;
    use model::insight_context::insights_backfill::InsightsBackfillBatchStatus;

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_create_insights_backfill_batch_with_id(pool: sqlx::PgPool) {
        let batch_id = "new-test-batch";
        let job_id = "test-job-1";
        let thread_ids = vec![
            "thread10".to_string(),
            "thread11".to_string(),
            "thread12".to_string(),
        ];

        let result =
            create_insights_backfill_batch_with_id(&pool, batch_id, job_id, &thread_ids, None)
                .await;
        assert!(result.is_ok());

        // Verify the batch was created
        let batch = get_insights_backfill_batch_by_id(&pool, batch_id)
            .await
            .unwrap();
        assert!(batch.is_some());

        let batch = batch.unwrap();
        assert_eq!(batch.id, batch_id);
        assert_eq!(batch.insights_backfill_job_id, job_id);
        assert_eq!(batch.total_threads, 3);
        assert_eq!(batch.status, InsightsBackfillBatchStatus::Queued);
        assert_eq!(batch.insights_generated_count, 0);
        assert!(batch.thread_ids.is_some());
        assert_eq!(batch.thread_ids.unwrap(), thread_ids);
        assert!(batch.queued_at.is_some());
        assert!(batch.started_at.is_none());
        assert!(batch.completed_at.is_none());
        assert!(batch.error_message.is_none());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_create_insights_backfill_batch_empty_threads(pool: sqlx::PgPool) {
        let batch_id = "empty-batch";
        let job_id = "test-job-1";
        let thread_ids: Vec<String> = vec![];

        let result =
            create_insights_backfill_batch_with_id(&pool, batch_id, job_id, &thread_ids, None)
                .await;
        assert!(result.is_ok());

        // Verify the batch was created with zero threads
        let batch = get_insights_backfill_batch_by_id(&pool, batch_id)
            .await
            .unwrap();
        assert!(batch.is_some());

        let batch = batch.unwrap();
        assert_eq!(batch.total_threads, 0);
        assert!(batch.thread_ids.is_some());
        assert!(batch.thread_ids.unwrap().is_empty());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_create_insights_backfill_batch_duplicate_id_fails(pool: sqlx::PgPool) {
        let batch_id = "test-batch-1"; // This ID already exists in fixture
        let job_id = "test-job-1";
        let thread_ids = vec!["thread20".to_string()];

        let result =
            create_insights_backfill_batch_with_id(&pool, batch_id, job_id, &thread_ids, None)
                .await;
        assert!(result.is_err());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_create_insights_backfill_batch_invalid_job_id_fails(pool: sqlx::PgPool) {
        let batch_id = "invalid-job-batch";
        let job_id = "non-existent-job";
        let thread_ids = vec!["thread30".to_string()];

        let result =
            create_insights_backfill_batch_with_id(&pool, batch_id, job_id, &thread_ids, None)
                .await;
        assert!(result.is_err()); // Should fail due to foreign key constraint
    }
}
