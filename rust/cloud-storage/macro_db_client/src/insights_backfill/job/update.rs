use anyhow::Result;
use chrono::{DateTime, Utc};
use model::insight_context::insights_backfill::InsightsBackfillJobStatus;
use sqlx::PgPool;

pub async fn update_insights_backfill_job_status(
    pool: &PgPool,
    job_id: &str,
    status: InsightsBackfillJobStatus,
) -> Result<()> {
    let now = Utc::now();

    // Set completed_at if status is terminal
    let completed_at = match status {
        InsightsBackfillJobStatus::Complete
        | InsightsBackfillJobStatus::Failed
        | InsightsBackfillJobStatus::Cancelled => Some(now),
        _ => None,
    };

    sqlx::query!(
        r#"
        UPDATE "EmailInsightsBackfillJob"
        SET 
            status = $2::"insights_backfill_job_status",
            "completedAt" = $3,
            "updatedAt" = $4
        WHERE id = $1
        "#,
        job_id,
        status as _,
        completed_at as Option<DateTime<Utc>>,
        now as DateTime<Utc>,
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Increment thread and insight counters for a job
pub async fn increment_insights_backfill_job_results(
    pool: &PgPool,
    job_id: &str,
    threads_processed_increment: i32,
    insights_generated_increment: i32,
) -> Result<()> {
    let now = Utc::now();

    sqlx::query!(
        r#"
        UPDATE "EmailInsightsBackfillJob"
        SET 
            "threadsProcessedCount" = "threadsProcessedCount" + $2,
            "insightsGeneratedCount" = "insightsGeneratedCount" + $3,
            "updatedAt" = $4
        WHERE id = $1
        "#,
        job_id,
        threads_processed_increment,
        insights_generated_increment,
        now as DateTime<Utc>
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod insight_backfill_tests {
    use super::*;
    use crate::insights_backfill::job::get::get_insights_backfill_job_by_id;
    use model::insight_context::insights_backfill::InsightsBackfillJobStatus;

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_update_insights_backfill_job_status_to_complete(pool: sqlx::PgPool) {
        let job_id = "test-job-1";

        // Verify initial state (InProgress)
        let job = get_insights_backfill_job_by_id(&pool, job_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(job.status, Some(InsightsBackfillJobStatus::InProgress));
        assert!(job.completed_at.is_none());

        // Update to Complete
        let result =
            update_insights_backfill_job_status(&pool, job_id, InsightsBackfillJobStatus::Complete)
                .await;
        if let Err(e) = &result {
            println!("Update job status error: {:?}", e);
        }
        assert!(result.is_ok());

        // Verify the update
        let job = get_insights_backfill_job_by_id(&pool, job_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(job.status, Some(InsightsBackfillJobStatus::Complete));
        assert!(job.completed_at.is_some());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_update_insights_backfill_job_status_to_failed(pool: sqlx::PgPool) {
        let job_id = "test-job-2";

        // Update to Failed
        let result =
            update_insights_backfill_job_status(&pool, job_id, InsightsBackfillJobStatus::Failed)
                .await;
        assert!(result.is_ok());

        // Verify the update
        let job = get_insights_backfill_job_by_id(&pool, job_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(job.status, Some(InsightsBackfillJobStatus::Failed));
        assert!(job.completed_at.is_some());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_update_insights_backfill_job_status_to_cancelled(pool: sqlx::PgPool) {
        let job_id = "test-job-2";

        // Update to Cancelled
        let result = update_insights_backfill_job_status(
            &pool,
            job_id,
            InsightsBackfillJobStatus::Cancelled,
        )
        .await;
        assert!(result.is_ok());

        // Verify the update
        let job = get_insights_backfill_job_by_id(&pool, job_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(job.status, Some(InsightsBackfillJobStatus::Cancelled));
        assert!(job.completed_at.is_some());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_update_insights_backfill_job_status_to_in_progress(pool: sqlx::PgPool) {
        let job_id = "test-job-2";

        // Verify initial state (Init)
        let job = get_insights_backfill_job_by_id(&pool, job_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(job.status, Some(InsightsBackfillJobStatus::Init));

        // Update to InProgress (non-terminal status)
        let result = update_insights_backfill_job_status(
            &pool,
            job_id,
            InsightsBackfillJobStatus::InProgress,
        )
        .await;
        assert!(result.is_ok());

        // Verify the update (should not set completed_at for non-terminal status)
        let job = get_insights_backfill_job_by_id(&pool, job_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(job.status, Some(InsightsBackfillJobStatus::InProgress));
        assert!(job.completed_at.is_none());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_increment_insights_backfill_job_results(pool: sqlx::PgPool) {
        let job_id = "test-job-1";
        let threads_increment = 5;
        let insights_increment = 8;

        // Get initial counts
        let initial_job = get_insights_backfill_job_by_id(&pool, job_id)
            .await
            .unwrap()
            .unwrap();
        let initial_threads = initial_job.threads_processed_count;
        let initial_insights = initial_job.insights_generated_count;

        // Increment the counters
        let result = increment_insights_backfill_job_results(
            &pool,
            job_id,
            threads_increment,
            insights_increment,
        )
        .await;
        assert!(result.is_ok());

        // Verify the increment
        let job = get_insights_backfill_job_by_id(&pool, job_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            job.threads_processed_count,
            initial_threads + threads_increment
        );
        assert_eq!(
            job.insights_generated_count,
            initial_insights + insights_increment
        );
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_increment_insights_backfill_job_results_zero_increment(pool: sqlx::PgPool) {
        let job_id = "test-job-1";

        // Get initial counts
        let initial_job = get_insights_backfill_job_by_id(&pool, job_id)
            .await
            .unwrap()
            .unwrap();
        let initial_threads = initial_job.threads_processed_count;
        let initial_insights = initial_job.insights_generated_count;

        // Increment with zero (should not change values)
        let result = increment_insights_backfill_job_results(&pool, job_id, 0, 0).await;
        assert!(result.is_ok());

        // Verify no change
        let job = get_insights_backfill_job_by_id(&pool, job_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(job.threads_processed_count, initial_threads);
        assert_eq!(job.insights_generated_count, initial_insights);
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_increment_insights_backfill_job_results_negative_increment(pool: sqlx::PgPool) {
        let job_id = "test-job-1";

        // Get initial counts
        let initial_job = get_insights_backfill_job_by_id(&pool, job_id)
            .await
            .unwrap()
            .unwrap();
        let initial_threads = initial_job.threads_processed_count;
        let initial_insights = initial_job.insights_generated_count;

        // Increment with negative values (should decrease)
        let result = increment_insights_backfill_job_results(&pool, job_id, -2, -1).await;
        assert!(result.is_ok());

        // Verify the decrement
        let job = get_insights_backfill_job_by_id(&pool, job_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(job.threads_processed_count, initial_threads - 2);
        assert_eq!(job.insights_generated_count, initial_insights - 1);
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_update_insights_backfill_job_status_nonexistent_job(pool: sqlx::PgPool) {
        let result = update_insights_backfill_job_status(
            &pool,
            "non-existent-job",
            InsightsBackfillJobStatus::Complete,
        )
        .await;

        // Should succeed even if no rows are affected
        assert!(result.is_ok());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_increment_insights_backfill_job_results_nonexistent_job(pool: sqlx::PgPool) {
        let result = increment_insights_backfill_job_results(&pool, "non-existent-job", 5, 3).await;

        // Should succeed even if no rows are affected
        assert!(result.is_ok());
    }
}
