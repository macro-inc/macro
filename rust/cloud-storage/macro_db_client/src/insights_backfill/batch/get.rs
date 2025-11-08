use anyhow::Result;
use model::insight_context::insights_backfill::{
    EmailInsightsBackfillBatch, InsightsBackfillBatchStatus,
};
use sqlx::PgPool;

pub async fn get_insights_backfill_batch_by_id(
    pool: &PgPool,
    batch_id: &str,
) -> Result<Option<EmailInsightsBackfillBatch>> {
    let batch = sqlx::query_as!(
        EmailInsightsBackfillBatch,
        r#"
        SELECT 
            id,
            "insightsBackfillJobId" as insights_backfill_job_id,
            "sqsMessageId" as sqs_message_id,
            "threadIds" as thread_ids,
            "totalThreads" as total_threads,
            status as "status!: InsightsBackfillBatchStatus",
            "insightsGeneratedCount" as insights_generated_count,
            "insightIds" as insight_ids,
            "errorMessage" as error_message,
            "queuedAt"::timestamptz as queued_at,
            "startedAt"::timestamptz as started_at,
            "completedAt"::timestamptz as completed_at,
            "createdAt"::timestamptz as "created_at!",
            "updatedAt"::timestamptz as "updated_at!"
        FROM "EmailInsightsBackfillBatch"
        WHERE id = $1
        "#,
        batch_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(batch)
}

#[cfg(test)]
mod insight_backfill_tests {
    use super::*;
    use model::insight_context::insights_backfill::InsightsBackfillBatchStatus;

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_get_insights_backfill_batch_by_id_exists(pool: sqlx::PgPool) {
        let result = get_insights_backfill_batch_by_id(&pool, "test-batch-1").await;

        assert!(result.is_ok());
        let batch = result.unwrap();
        assert!(batch.is_some());

        let batch = batch.unwrap();
        assert_eq!(batch.id, "test-batch-1");
        assert_eq!(batch.insights_backfill_job_id, "test-job-1");
        assert_eq!(batch.total_threads, 3);
        assert_eq!(batch.status, InsightsBackfillBatchStatus::Complete);
        assert_eq!(batch.insights_generated_count, 5);
        assert!(batch.thread_ids.is_some());
        assert_eq!(batch.thread_ids.as_ref().unwrap().len(), 3);
        assert!(batch.completed_at.is_some());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_get_insights_backfill_batch_by_id_in_progress(pool: sqlx::PgPool) {
        let result = get_insights_backfill_batch_by_id(&pool, "test-batch-2").await;

        assert!(result.is_ok());
        let batch = result.unwrap();
        assert!(batch.is_some());

        let batch = batch.unwrap();
        assert_eq!(batch.id, "test-batch-2");
        assert_eq!(batch.status, InsightsBackfillBatchStatus::InProgress);
        assert_eq!(batch.insights_generated_count, 0);
        assert!(batch.started_at.is_some());
        assert!(batch.completed_at.is_none());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_get_insights_backfill_batch_by_id_failed(pool: sqlx::PgPool) {
        let result = get_insights_backfill_batch_by_id(&pool, "test-batch-failed").await;

        assert!(result.is_ok());
        let batch = result.unwrap();
        assert!(batch.is_some());

        let batch = batch.unwrap();
        assert_eq!(batch.id, "test-batch-failed");
        assert_eq!(batch.status, InsightsBackfillBatchStatus::Failed);
        assert!(batch.error_message.is_some());
        assert_eq!(
            batch.error_message.as_ref().unwrap(),
            "Processing error occurred"
        );
        assert!(batch.completed_at.is_some());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_get_insights_backfill_batch_by_id_queued(pool: sqlx::PgPool) {
        let result = get_insights_backfill_batch_by_id(&pool, "test-batch-queued").await;

        assert!(result.is_ok());
        let batch = result.unwrap();
        assert!(batch.is_some());

        let batch = batch.unwrap();
        assert_eq!(batch.id, "test-batch-queued");
        assert_eq!(batch.status, InsightsBackfillBatchStatus::Queued);
        assert_eq!(batch.insights_generated_count, 0);
        assert!(batch.queued_at.is_none());
        assert!(batch.started_at.is_none());
        assert!(batch.completed_at.is_none());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_get_insights_backfill_batch_by_id_not_found(pool: sqlx::PgPool) {
        let result = get_insights_backfill_batch_by_id(&pool, "non-existent-batch").await;

        assert!(result.is_ok());
        let batch = result.unwrap();
        assert!(batch.is_none());
    }
}
