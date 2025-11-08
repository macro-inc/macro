use anyhow::Result;
use model::insight_context::insights_backfill::{
    EmailInsightsBackfillJob, InsightsBackfillJobStatus,
};
use sqlx::PgPool;

pub async fn get_insights_backfill_job_by_id(
    pool: &PgPool,
    job_id: &str,
) -> Result<Option<EmailInsightsBackfillJob>> {
    let job = sqlx::query_as!(
        EmailInsightsBackfillJob,
        r#"
        SELECT 
            id,
            "userId" as user_id,
            "threadsProcessedCount" as threads_processed_count,
            "insightsGeneratedCount" as insights_generated_count,
            status as "status: InsightsBackfillJobStatus",
            "completedAt"::timestamptz as completed_at,
            "createdAt"::timestamptz as "created_at!",
            "updatedAt"::timestamptz as "updated_at!"
        FROM "EmailInsightsBackfillJob"
        WHERE id = $1
        "#,
        job_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(job)
}

#[cfg(test)]
mod insight_backfill_tests {
    use super::*;
    use model::insight_context::insights_backfill::InsightsBackfillJobStatus;

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_get_insights_backfill_job_by_id_in_progress(pool: sqlx::PgPool) {
        let result = get_insights_backfill_job_by_id(&pool, "test-job-1").await;

        assert!(result.is_ok());
        let job = result.unwrap();
        assert!(job.is_some());

        let job = job.unwrap();
        assert_eq!(job.id, "test-job-1");
        assert_eq!(job.user_id, "test-user-1");
        assert_eq!(job.threads_processed_count, 25);
        assert_eq!(job.insights_generated_count, 10);
        assert_eq!(job.status, Some(InsightsBackfillJobStatus::InProgress));
        assert!(job.completed_at.is_none());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_get_insights_backfill_job_by_id_init(pool: sqlx::PgPool) {
        let result = get_insights_backfill_job_by_id(&pool, "test-job-2").await;

        assert!(result.is_ok());
        let job = result.unwrap();
        assert!(job.is_some());

        let job = job.unwrap();
        assert_eq!(job.id, "test-job-2");
        assert_eq!(job.status, Some(InsightsBackfillJobStatus::Init));
        assert_eq!(job.threads_processed_count, 0);
        assert_eq!(job.insights_generated_count, 0);
        assert!(job.completed_at.is_none());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_get_insights_backfill_job_by_id_complete(pool: sqlx::PgPool) {
        let result = get_insights_backfill_job_by_id(&pool, "test-job-complete").await;

        assert!(result.is_ok());
        let job = result.unwrap();
        assert!(job.is_some());

        let job = job.unwrap();
        assert_eq!(job.id, "test-job-complete");
        assert_eq!(job.status, Some(InsightsBackfillJobStatus::Complete));
        assert_eq!(job.threads_processed_count, 10);
        assert_eq!(job.insights_generated_count, 5);
        assert!(job.completed_at.is_some());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_get_insights_backfill_job_by_id_not_found(pool: sqlx::PgPool) {
        let result = get_insights_backfill_job_by_id(&pool, "non-existent-job").await;

        assert!(result.is_ok());
        let job = result.unwrap();
        assert!(job.is_none());
    }
}
