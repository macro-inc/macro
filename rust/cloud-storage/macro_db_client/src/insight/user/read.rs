use anyhow::Result;
use model::insight_context::{InsightType, SourceLocation, UserInsightRecord, UserInsightRow};
use sqlx::Executor;
use sqlx::postgres::Postgres;
use sqlx::types::Json;

#[tracing::instrument(skip(db))]
pub async fn read_recent_insights<'e, E>(
    db: E,
    user_id: &str,
    limit: i64,
    source: String,
) -> Result<Vec<UserInsightRecord>>
where
    E: Executor<'e, Database = Postgres>,
{
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
        "UserInsights" u
    WHERE 
        u."userId" = $1
    AND
        u."source" = $2
    ORDER BY 
        u."createdAt" DESC
    LIMIT $3
    "#,
        user_id,
        source,
        limit,
    )
    .fetch_all(db)
    .await?;

    let insights = records.into_iter().map(|r| r.into()).collect();

    Ok(insights)
}

/// Read insights with smart ranking for LLM context selection
#[tracing::instrument(skip(db))]
pub async fn read_insights_for_context<'e, E>(
    db: E,
    user_id: &str,
    source: String,
    query_keywords: Option<Vec<String>>,
    prefer_actionable: bool,
    max_insights: usize,
) -> Result<Vec<UserInsightRecord>>
where
    E: Executor<'e, Database = Postgres>,
{
    // First, get all insights for the user and source (with a reasonable limit)
    let all_insights = read_recent_insights(db, user_id, 1000, source).await?;

    // Then apply smart ranking
    // Note: This would need to import from insight_service crate
    // For now, we'll just return the insights ordered by confidence and recency
    let mut ranked_insights = all_insights;
    ranked_insights.sort_by(|a, b| {
        // Sort by confidence (desc) then by created_at (desc)
        let conf_a = a.confidence.unwrap_or(0);
        let conf_b = b.confidence.unwrap_or(0);
        match conf_b.cmp(&conf_a) {
            std::cmp::Ordering::Equal => b.created_at.cmp(&a.created_at),
            other => other,
        }
    });

    ranked_insights.truncate(max_insights);

    Ok(ranked_insights)
}

#[tracing::instrument(skip(db))]
pub async fn get_user_insights<'e, E>(
    db: E,
    user_id: &str,
    generated: Option<bool>,
    limit: u32,
    offset: u32,
) -> Result<Vec<UserInsightRecord>>
where
    E: Executor<'e, Database = Postgres>,
{
    match generated {
        Some(filter) => {
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
            generated = $2
        ORDER BY 
            "updatedAt" DESC
        LIMIT 
            $3
        OFFSET
            $4
        "#,
                user_id,
                filter,
                limit as i64,
                offset as i64
            )
            .fetch_all(db)
            .await?;

            let records = records.into_iter().map(|r| r.into()).collect();
            Ok(records)
        }

        None => {
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
        ORDER BY 
            "updatedAt" DESC
        LIMIT 
            $2
        OFFSET
            $3
        "#,
                user_id,
                limit as i64,
                offset as i64
            )
            .fetch_all(db)
            .await?;

            let records = records.into_iter().map(|r| r.into()).collect();
            Ok(records)
        }
    }
}

#[tracing::instrument(skip(db))]
pub async fn get_insight<'e, E>(db: E, id: &str, user_id: &str) -> Result<Option<UserInsightRecord>>
where
    E: Executor<'e, Database = Postgres>,
{
    let record = sqlx::query_as!(
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
            "id" = $2
    "#,
        user_id,
        id
    )
    .fetch_optional(db)
    .await?;

    let record = record.map(|r| r.into());

    Ok(record)
}

pub async fn count_total<'e, E>(db: E, generated: Option<bool>, user_id: &str) -> Result<i64>
where
    E: Executor<'e, Database = Postgres>,
{
    if let Some(generated) = generated {
        let count = sqlx::query!(
            r#"
                SELECT 
                    COUNT(id) as count
                FROM 
                    "UserInsights" i
                WHERE
                    i."userId" = $1
                    AND
                    i."generated" = $2
            "#,
            user_id,
            generated
        )
        .fetch_one(db)
        .await?;

        Ok(count.count.ok_or_else(|| sqlx::Error::RowNotFound)?)
    } else {
        let count = sqlx::query!(
            r#"
                SELECT 
                    COUNT(id) as count
                FROM 
                    "UserInsights" i
                WHERE
                    i."userId" = $1
            "#,
            user_id,
        )
        .fetch_one(db)
        .await?;
        Ok(count.count.ok_or_else(|| sqlx::Error::RowNotFound)?)
    }
}

#[cfg(test)]
mod insight_tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../fixtures", scripts("user_insights")))]
    async fn test_read_recent_insights(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "macro|user1@macro.com";
        let source = "test_source";
        let results = read_recent_insights(&pool, user_id, 10, source.to_string()).await?;
        assert_eq!(results.len(), 2);
        let expected1 = UserInsightRecord {
            id: Some("insight1".to_string()),
            user_id: user_id.to_string(),
            content: "Insight content 1".to_string(),
            source: source.to_string(),
            generated: true,
            created_at: results[0].created_at,
            updated_at: results[0].updated_at,
            span_start: results[0].span_start,
            span_end: results[0].span_end,
            confidence: Some(5),
            source_location: results[0].source_location.clone(),
            insight_type: results[0].insight_type,
            relevance_keywords: results[0].relevance_keywords.clone(),
        };
        let expected2 = UserInsightRecord {
            id: Some("insight2".to_string()),
            user_id: user_id.to_string(),
            content: "Insight content 2".to_string(),
            source: source.to_string(),
            generated: false,
            created_at: results[1].created_at,
            updated_at: results[1].updated_at,
            span_start: results[1].span_start,
            span_end: results[1].span_end,
            confidence: Some(1),
            source_location: results[1].source_location.clone(),
            insight_type: results[1].insight_type,
            relevance_keywords: results[1].relevance_keywords.clone(),
        };
        assert_eq!(results[0], expected1);
        assert_eq!(results[1], expected2);
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../fixtures", scripts("user_insights")))]
    async fn test_get_user_insights(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "macro|user1@macro.com";
        let all = get_user_insights(&pool, user_id, None, 10, 0).await?;
        assert_eq!(all.len(), 2);
        let expected1 = UserInsightRecord {
            id: Some("insight1".to_string()),
            user_id: user_id.to_string(),
            content: "Insight content 1".to_string(),
            source: "test_source".to_string(),
            generated: true,
            created_at: all[0].created_at,
            updated_at: all[0].updated_at,
            span_start: all[0].span_start,
            span_end: all[0].span_end,
            confidence: Some(5),
            source_location: all[0].source_location.clone(),
            insight_type: all[0].insight_type,
            relevance_keywords: all[0].relevance_keywords.clone(),
        };
        let expected2 = UserInsightRecord {
            id: Some("insight2".to_string()),
            user_id: user_id.to_string(),
            content: "Insight content 2".to_string(),
            source: "test_source".to_string(),
            generated: false,
            created_at: all[1].created_at,
            updated_at: all[1].updated_at,
            span_start: all[1].span_start,
            span_end: all[1].span_end,
            confidence: Some(1),
            source_location: all[1].source_location.clone(),
            insight_type: all[1].insight_type,
            relevance_keywords: all[1].relevance_keywords.clone(),
        };
        assert_eq!(all[0], expected1);
        assert_eq!(all[1], expected2);
        let generated = get_user_insights(&pool, user_id, Some(true), 10, 0).await?;
        assert_eq!(generated.len(), 1);
        assert_eq!(generated[0], expected1);
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../fixtures", scripts("user_insights")))]
    async fn test_get_insight(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "macro|user1@macro.com";
        let id = "insight1";
        let found = get_insight(&pool, id, user_id).await?;
        assert!(found.is_some());
        let record = found.unwrap();
        let expected = UserInsightRecord {
            id: Some(id.to_string()),
            user_id: user_id.to_string(),
            content: "Insight content 1".to_string(),
            source: "test_source".to_string(),
            generated: true,
            created_at: record.created_at,
            updated_at: record.updated_at,
            span_start: record.span_start,
            span_end: record.span_end,
            confidence: Some(5),
            source_location: record.source_location.clone(),
            insight_type: record.insight_type,
            relevance_keywords: record.relevance_keywords.clone(),
        };
        assert_eq!(record, expected);
        Ok(())
    }
}
