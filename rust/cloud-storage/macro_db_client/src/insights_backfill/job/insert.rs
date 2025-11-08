use anyhow::Result;
use sqlx::PgPool;

/// Create a new insights backfill job with specific job ID
pub async fn create_insights_backfill_job_with_id(
    pool: &PgPool,
    job_id: &str,
    user_id: &str,
) -> Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO "EmailInsightsBackfillJob" (
            id, "userId", status, "createdAt", "updatedAt"
        ) VALUES (
            $1, $2, 'InProgress'::"insights_backfill_job_status", NOW(), NOW()
        )
        "#,
        job_id,
        user_id,
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
    async fn test_create_insights_backfill_job_with_id_basic(pool: sqlx::PgPool) {
        let job_id = "new-test-job";
        let user_id = "test-user-1";

        let result = create_insights_backfill_job_with_id(&pool, job_id, user_id).await;
        assert!(result.is_ok());

        // Verify the job was created
        let job = get_insights_backfill_job_by_id(&pool, job_id)
            .await
            .unwrap();
        assert!(job.is_some());

        let job = job.unwrap();
        assert_eq!(job.id, job_id);
        assert_eq!(job.user_id, user_id);
        assert_eq!(job.status, Some(InsightsBackfillJobStatus::InProgress));
        assert_eq!(job.threads_processed_count, 0);
        assert_eq!(job.insights_generated_count, 0);
        assert!(job.completed_at.is_none());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_create_insights_backfill_job_with_id_minimal(pool: sqlx::PgPool) {
        let job_id = "minimal-job";
        let user_id = "test-user-1";

        let result = create_insights_backfill_job_with_id(&pool, job_id, user_id).await;
        if let Err(e) = &result {
            println!("Create job error: {:?}", e);
        }
        assert!(result.is_ok());

        // Verify the job was created
        let job = get_insights_backfill_job_by_id(&pool, job_id)
            .await
            .unwrap();
        assert!(job.is_some());

        let job = job.unwrap();
        assert_eq!(job.id, job_id);
        assert_eq!(job.user_id, user_id);
        assert_eq!(job.status, Some(InsightsBackfillJobStatus::InProgress));
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_create_insights_backfill_job_duplicate_id_fails(pool: sqlx::PgPool) {
        let job_id = "test-job-1"; // This ID already exists in fixture
        let user_id = "test-user-1";

        let result = create_insights_backfill_job_with_id(&pool, job_id, user_id).await;
        assert!(result.is_err()); // Should fail due to unique constraint
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_create_insights_backfill_job_with_non_existent_user_fails(pool: sqlx::PgPool) {
        let job_id = "non-existent-user-job";
        let user_id = "non-existent-user";

        let result = create_insights_backfill_job_with_id(&pool, job_id, user_id).await;
        assert!(result.is_err()); // Should fail due to foreign key constraint
    }
}
