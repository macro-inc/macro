use anyhow::Result;
use chrono::{DateTime, Utc};
use model::insight_context::UserInsightRecord;
use sqlx::Executor;
use sqlx::postgres::Postgres;
use sqlx::types::Json;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum BatchError {
    #[error(
        "Expected {expected} insights for user {user_id}, but got {actual}. Some insights may have been deleted."
    )]
    IncompleteInsights {
        expected: usize,
        actual: usize,
        user_id: String,
    },
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Other error: {0}")]
    Other(#[from] anyhow::Error),
}

#[derive(Debug, sqlx::FromRow)]
pub struct UserInsightBatchRow {
    pub id: String,
    pub user_id: String,
    pub insight_ids: Option<Vec<String>>,
    pub total_chars: i32,
    pub estimated_tokens: i32,
    pub ranking_context: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub version: i32,
}

/// Get the current cached insight batch for a user
#[tracing::instrument(skip(db))]
pub async fn get_user_insight_batch<'e, E>(
    db: E,
    user_id: &str,
) -> Result<Option<UserInsightBatchRow>>
where
    E: Executor<'e, Database = Postgres>,
{
    let batch = sqlx::query_as!(
        UserInsightBatchRow,
        r#"
        SELECT 
            "id",
            "userId" as "user_id",
            "insightIds" as "insight_ids",
            "totalChars" as "total_chars",
            "estimatedTokens" as "estimated_tokens",
            "rankingContext" as "ranking_context",
            "createdAt"::timestamptz as "created_at!",
            "expiresAt"::timestamptz as "expires_at!",
            "version"
        FROM 
            "UserInsightBatch"
        WHERE 
            "userId" = $1
        AND 
            "expiresAt" > NOW()
        "#,
        user_id
    )
    .fetch_optional(db)
    .await?;

    Ok(batch)
}

/// Create or update a user's cached insight batch
#[tracing::instrument(skip(db))]
pub async fn upsert_user_insight_batch<'e, E>(
    db: E,
    user_id: &str,
    insight_ids: &[String],
    total_chars: i32,
    estimated_tokens: i32,
    expires_at: DateTime<Utc>,
    ranking_context: Option<&serde_json::Value>,
) -> Result<String>
where
    E: Executor<'e, Database = Postgres>,
{
    let batch_id = sqlx::query_scalar!(
        r#"
        INSERT INTO "UserInsightBatch" (
            "userId", 
            "insightIds", 
            "totalChars", 
            "estimatedTokens", 
            "expiresAt",
            "rankingContext"
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT ("userId") 
        DO UPDATE SET
            "insightIds" = EXCLUDED."insightIds",
            "totalChars" = EXCLUDED."totalChars",
            "estimatedTokens" = EXCLUDED."estimatedTokens",
            "expiresAt" = EXCLUDED."expiresAt",
            "rankingContext" = EXCLUDED."rankingContext",
            "version" = "UserInsightBatch"."version" + 1,
            "createdAt" = NOW()
        RETURNING "id"
        "#,
        user_id,
        insight_ids,
        total_chars,
        estimated_tokens,
        expires_at.naive_utc(),
        ranking_context
    )
    .fetch_one(db)
    .await?;

    Ok(batch_id)
}

/// Get insights for a cached batch by insight IDs
#[tracing::instrument(skip(db))]
pub async fn get_insights_by_batch<'e, E>(
    db: E,
    user_id: &str,
    insight_ids: &[String],
) -> Result<Vec<UserInsightRecord>, BatchError>
where
    E: Executor<'e, Database = Postgres>,
{
    use model::insight_context::{InsightType, SourceLocation, UserInsightRow};

    let records = sqlx::query_as!(
        UserInsightRow,
        r#"
        SELECT 
            "id",
            "userId" as "user_id",
            "content",
            "source", 
            "sourceLocation" as "source_location: Json<SourceLocation>",
            "generated",
            "createdAt"::timestamptz as "created_at!",
            "updatedAt"::timestamptz as "updated_at!",
            "spanStart"::timestamptz as "span_start",
            "spanEnd"::timestamptz as "span_end",
            "confidence",
            "insightType" as "insight_type: InsightType",
            "relevanceKeywords" as "relevance_keywords"
        FROM 
            "UserInsights"
        WHERE 
            "userId" = $1
        AND 
            "id" = ANY($2)
        ORDER BY 
            array_position($2, "id")
        "#,
        user_id,
        insight_ids
    )
    .fetch_all(db)
    .await?;

    // Validate that we got the exact number of insights requested
    if records.len() != insight_ids.len() {
        return Err(BatchError::IncompleteInsights {
            expected: insight_ids.len(),
            actual: records.len(),
            user_id: user_id.to_string(),
        });
    }

    Ok(records.into_iter().map(UserInsightRecord::from).collect())
}

/// Delete a specific user's insight batch
#[tracing::instrument(skip(db))]
pub async fn delete_user_insight_batch<'e, E>(db: E, user_id: &str) -> Result<bool>
where
    E: Executor<'e, Database = Postgres>,
{
    let rows_affected = sqlx::query!(
        r#"
        DELETE FROM "UserInsightBatch"
        WHERE "userId" = $1
        "#,
        user_id
    )
    .execute(db)
    .await?;

    Ok(rows_affected.rows_affected() > 0)
}

/// Delete expired insight batches (cleanup job)
#[tracing::instrument(skip(db))]
pub async fn delete_expired_insight_batches<'e, E>(db: E) -> Result<u64>
where
    E: Executor<'e, Database = Postgres>,
{
    let rows_affected = sqlx::query!(
        r#"
        DELETE FROM "UserInsightBatch"
        WHERE "expiresAt" <= NOW()
        "#
    )
    .execute(db)
    .await?;

    Ok(rows_affected.rows_affected())
}

/// Check if user has new insights since last batch creation
#[tracing::instrument(skip(db))]
pub async fn has_new_insights_since_batch<'e, E>(
    db: E,
    user_id: &str,
    batch_created_at: DateTime<Utc>,
) -> Result<bool>
where
    E: Executor<'e, Database = Postgres>,
{
    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM "UserInsights"
        WHERE "userId" = $1
        AND "createdAt" > $2
        AND "generated" = true
        "#,
        user_id,
        batch_created_at.naive_utc()
    )
    .fetch_one(db)
    .await?;

    Ok(count > 0)
}

/// Get users who need new insight batches (for daily job)
#[tracing::instrument(skip(db))]
pub async fn get_users_needing_batch_refresh<'e, E>(db: E, limit: i64) -> Result<Vec<String>>
where
    E: Executor<'e, Database = Postgres>,
{
    let user_ids = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT u."id" as "user_id"
        FROM "User" u
        INNER JOIN "UserInsights" ui ON u."id" = ui."userId"
        LEFT JOIN "UserInsightBatch" uib ON u."id" = uib."userId"
        WHERE 
            ui."generated" = true
            AND ui."createdAt" > COALESCE(uib."createdAt", '1970-01-01'::timestamptz)
        OR 
            uib."expiresAt" <= NOW()
        ORDER BY u."id"
        LIMIT $1
        "#,
        limit
    )
    .fetch_all(db)
    .await?;

    Ok(user_ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    #[sqlx::test(fixtures("../../../fixtures/users.sql"))]
    async fn test_get_insights_by_batch_validation(pool: PgPool) -> Result<()> {
        let user_id = "macro|user1@example.com";

        // Test case: Request insights that don't exist (simulates manually deleted insights)
        let non_existent_insight_ids = vec![
            "non_existent_id_1".to_string(),
            "non_existent_id_2".to_string(),
        ];

        let result = get_insights_by_batch(&pool, user_id, &non_existent_insight_ids).await;

        // Should return an IncompleteInsights error
        assert!(result.is_err());
        match result.unwrap_err() {
            BatchError::IncompleteInsights {
                expected,
                actual,
                user_id: error_user_id,
            } => {
                assert_eq!(expected, 2);
                assert_eq!(actual, 0);
                assert_eq!(error_user_id, user_id);
            }
            _ => panic!("Expected IncompleteInsights error"),
        }

        Ok(())
    }

    #[test]
    fn test_validation_logic() {
        // Test that validation logic works correctly
        let error = BatchError::IncompleteInsights {
            expected: 3,
            actual: 1,
            user_id: "test_user".to_string(),
        };

        let error_msg = error.to_string();
        assert!(error_msg.contains("Expected 3 insights"));
        assert!(error_msg.contains("but got 1"));
        assert!(error_msg.contains("Some insights may have been deleted"));
        assert!(error_msg.contains("test_user"));

        match error {
            BatchError::IncompleteInsights {
                expected,
                actual,
                user_id,
            } => {
                assert_eq!(expected, 3);
                assert_eq!(actual, 1);
                assert_eq!(user_id, "test_user");
            }
            _ => panic!("Wrong error type"),
        }
    }
}
