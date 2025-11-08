use anyhow::Result;
use chrono::{DateTime, Utc};
use model::insight_context::insights_backfill::InsightsBackfillBatchStatus;
use sqlx::PgPool;

pub async fn update_insights_backfill_batch_status(
    pool: &PgPool,
    batch_id: &str,
    status: InsightsBackfillBatchStatus,
    error_message: Option<&str>,
    sqs_message_id: Option<&str>,
) -> Result<()> {
    let now = Utc::now();

    let completed_at = match status {
        InsightsBackfillBatchStatus::Complete | InsightsBackfillBatchStatus::Failed => Some(now),
        _ => None,
    };

    let started_at = match status {
        InsightsBackfillBatchStatus::InProgress => Some(now),
        _ => None,
    };

    sqlx::query!(
        r#"
        UPDATE "EmailInsightsBackfillBatch"
        SET 
            status = $2::"insights_backfill_batch_status",
            "errorMessage" = $3,
            "sqsMessageId" = COALESCE("sqsMessageId", $4),
            "startedAt" = COALESCE("startedAt", $5),
            "completedAt" = $6,
            "updatedAt" = $7
        WHERE id = $1
        "#,
        batch_id,
        status as _,
        error_message,
        sqs_message_id,
        started_at as Option<DateTime<Utc>>,
        completed_at as Option<DateTime<Utc>>,
        now as DateTime<Utc>
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Update insights generated count and insight IDs for batch
pub async fn update_insights_backfill_batch_results(
    pool: &PgPool,
    batch_id: &str,
    insights_generated_count: i32,
    insight_ids: Vec<String>,
) -> Result<()> {
    let now = Utc::now();

    sqlx::query!(
        r#"
        UPDATE "EmailInsightsBackfillBatch"
        SET 
            "insightsGeneratedCount" = $2,
            "insightIds" = $3,
            "updatedAt" = $4
        WHERE id = $1
        "#,
        batch_id,
        insights_generated_count,
        &insight_ids,
        now as DateTime<Utc>
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
    async fn test_update_insights_backfill_batch_status_to_in_progress(pool: sqlx::PgPool) {
        let batch_id = "test-batch-queued";

        // Verify initial state
        let batch = get_insights_backfill_batch_by_id(&pool, batch_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(batch.status, InsightsBackfillBatchStatus::Queued);
        assert!(batch.started_at.is_none());

        // Update to InProgress
        let result = update_insights_backfill_batch_status(
            &pool,
            batch_id,
            InsightsBackfillBatchStatus::InProgress,
            None,
            None,
        )
        .await;
        assert!(result.is_ok());

        // Verify the update
        let batch = get_insights_backfill_batch_by_id(&pool, batch_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(batch.status, InsightsBackfillBatchStatus::InProgress);
        assert!(batch.started_at.is_some());
        assert!(batch.completed_at.is_none());
        assert!(batch.error_message.is_none());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_update_insights_backfill_batch_status_to_complete(pool: sqlx::PgPool) {
        let batch_id = "test-batch-2";

        // Verify initial state (InProgress)
        let batch = get_insights_backfill_batch_by_id(&pool, batch_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(batch.status, InsightsBackfillBatchStatus::InProgress);
        assert!(batch.completed_at.is_none());

        // Update to Complete
        let result = update_insights_backfill_batch_status(
            &pool,
            batch_id,
            InsightsBackfillBatchStatus::Complete,
            None,
            None,
        )
        .await;
        assert!(result.is_ok());

        // Verify the update
        let batch = get_insights_backfill_batch_by_id(&pool, batch_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(batch.status, InsightsBackfillBatchStatus::Complete);
        assert!(batch.completed_at.is_some());
        assert!(batch.error_message.is_none());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_update_insights_backfill_batch_status_to_failed_with_error(pool: sqlx::PgPool) {
        let batch_id = "test-batch-2";
        let error_msg = "Test processing error";

        // Update to Failed with error message
        let result = update_insights_backfill_batch_status(
            &pool,
            batch_id,
            InsightsBackfillBatchStatus::Failed,
            Some(error_msg),
            None,
        )
        .await;
        assert!(result.is_ok());

        // Verify the update
        let batch = get_insights_backfill_batch_by_id(&pool, batch_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(batch.status, InsightsBackfillBatchStatus::Failed);
        assert!(batch.completed_at.is_some());
        assert!(batch.error_message.is_some());
        assert_eq!(batch.error_message.unwrap(), error_msg);
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_update_insights_backfill_batch_results(pool: sqlx::PgPool) {
        let batch_id = "test-batch-2";
        let new_count = 15;
        let insight_ids = vec!["insight-1".to_string(), "insight-2".to_string()];

        // Verify initial count
        let batch = get_insights_backfill_batch_by_id(&pool, batch_id)
            .await
            .unwrap()
            .unwrap();
        let initial_count = batch.insights_generated_count;
        assert_ne!(initial_count, new_count);

        // Update insights count and IDs
        let result =
            update_insights_backfill_batch_results(&pool, batch_id, new_count, insight_ids.clone())
                .await;
        assert!(result.is_ok());

        // Verify the update
        let batch = get_insights_backfill_batch_by_id(&pool, batch_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(batch.insights_generated_count, new_count);
        assert_eq!(batch.insight_ids, Some(insight_ids));
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("insights_backfill")))]
    async fn test_update_insights_backfill_batch_status_nonexistent_batch(pool: sqlx::PgPool) {
        let result = update_insights_backfill_batch_status(
            &pool,
            "non-existent-batch",
            InsightsBackfillBatchStatus::Complete,
            None,
            None,
        )
        .await;

        // Should succeed even if no rows are affected
        assert!(result.is_ok());
    }
}
