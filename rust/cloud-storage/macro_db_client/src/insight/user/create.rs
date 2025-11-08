use model::insight_context::UserInsightRecord;
use serde_json;
use sqlx::Executor;
use sqlx::error::Error;
use sqlx::postgres::Postgres;

#[tracing::instrument(skip(db))]
pub async fn create_insights<'e, E>(
    db: E,
    insights: &Vec<UserInsightRecord>,
    user_id: &str,
) -> Result<Vec<String>, Error>
where
    E: Executor<'e, Database = Postgres>,
{
    if insights.is_empty() {
        return Ok(vec![]);
    }

    let mut query_builder = sqlx::QueryBuilder::new(
        r#"INSERT INTO "UserInsights" ("userId", content, source, generated, confidence, "sourceLocation", "insightType", "relevanceKeywords", "spanStart", "spanEnd") "#,
    );

    query_builder.push_values(insights.iter(), |mut b, insight| {
        b.push_bind(user_id)
            .push_bind(&insight.content)
            .push_bind(insight.source.to_string())
            .push_bind(insight.generated)
            .push_bind(insight.confidence)
            .push_bind(
                insight
                    .source_location
                    .as_ref()
                    .map(|loc| serde_json::to_value(loc).unwrap()),
            )
            .push_bind(insight.insight_type.as_ref().map(|it| it.to_string()))
            .push_bind(&insight.relevance_keywords)
            .push_bind(insight.span_start)
            .push_bind(insight.span_end);
    });

    query_builder.push(" RETURNING id");

    let ids = query_builder
        .build_query_scalar::<String>()
        .fetch_all(db)
        .await?;
    Ok(ids)
}

#[cfg(test)]
mod insight_tests {
    use super::*;
    use crate::insight::user::read::get_insight;
    use chrono::Utc;
    use model::insight_context::{EmailSourceLocation, SourceLocation, UserInsightRecord};
    use sqlx::{Pool, Postgres};
    use uuid::Uuid;

    #[sqlx::test(fixtures(path = "../fixtures"))]
    async fn test_create_insights_with_source_location(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Insert a user for FK constraint
        sqlx::query!(
            r#"INSERT INTO "User" (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING"#,
            "macro|user1@macro.com",
            "user1@macro.com"
        )
        .execute(&pool)
        .await?;

        let now = Utc::now();
        let insight = UserInsightRecord {
            id: None,
            user_id: "macro|user1@macro.com".to_string(),
            content: "Test content".to_string(),
            source: "test_source".to_string(),
            generated: true,
            created_at: now,
            updated_at: now,
            span_start: None,
            span_end: None,
            confidence: Some(5), // High confidence on 1-5 scale
            source_location: Some(SourceLocation::Email(EmailSourceLocation {
                thread_ids: vec![],
                message_ids: vec![],
                email_addresses: None,
            })),
            insight_type: Some(model::insight_context::InsightType::Actionable),
            relevance_keywords: Some(vec!["test".to_string(), "email".to_string()]),
        };
        let ids = create_insights(&pool, &vec![insight.clone()], &insight.user_id).await?;
        assert_eq!(ids.len(), 1);
        // Fetch and check
        let rec = sqlx::query!(r#"SELECT content, source, generated, confidence, "sourceLocation" FROM "UserInsights" WHERE id = $1"#, ids[0]).fetch_one(&pool).await?;
        assert_eq!(rec.content, insight.content);
        assert_eq!(rec.source, insight.source);
        assert_eq!(rec.generated, insight.generated);
        assert_eq!(rec.confidence, Some(5));
        let loc: SourceLocation = serde_json::from_value(rec.sourceLocation.unwrap()).unwrap();
        assert_eq!(loc, insight.source_location.unwrap());
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../fixtures"))]
    async fn test_create_and_get_insight_with_source_location(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        // Insert a user for FK constraint
        sqlx::query!(
            r#"INSERT INTO "User" (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING"#,
            "macro|user1@macro.com",
            "user1@macro.com"
        )
        .execute(&pool)
        .await?;

        let now = Utc::now();
        let insight = UserInsightRecord {
            id: None,
            user_id: "macro|user1@macro.com".to_string(),
            content: "Test content for get_insight".to_string(),
            source: "test_source".to_string(),
            generated: true,
            created_at: now,
            updated_at: now,
            span_start: None,
            span_end: None,
            confidence: Some(5),
            source_location: Some(SourceLocation::Email(EmailSourceLocation {
                thread_ids: vec![],
                message_ids: vec![
                    Uuid::parse_str("11111111-1111-1111-1111-111111111111")
                        .unwrap()
                        .to_string(),
                ],
                email_addresses: None,
            })),
            insight_type: Some(model::insight_context::InsightType::Informational),
            relevance_keywords: Some(vec!["testing".to_string(), "source_location".to_string()]),
        };
        let ids = create_insights(&pool, &vec![insight.clone()], &insight.user_id).await?;
        assert_eq!(ids.len(), 1);
        let id = &ids[0];
        let found = get_insight(&pool, id, &insight.user_id).await?;
        assert!(found.is_some());
        let found = found.unwrap();
        // The DB sets id, created_at, updated_at, so update our expected record for comparison
        let mut expected = insight.clone();
        expected.id = Some(id.clone());
        expected.created_at = found.created_at;
        expected.updated_at = found.updated_at;
        assert_eq!(found, expected);
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../fixtures"))]
    async fn test_create_insights_with_relevance_keywords_array(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        // Insert a user for FK constraint
        sqlx::query!(
            r#"INSERT INTO "User" (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING"#,
            "macro|user2@macro.com",
            "user2@macro.com"
        )
        .execute(&pool)
        .await?;

        let now = Utc::now();

        // Test different array scenarios
        let insights = vec![
            // Insight with multiple keywords
            UserInsightRecord {
                id: None,
                user_id: "macro|user2@macro.com".to_string(),
                content: "User prefers morning meetings and uses Slack for communication"
                    .to_string(),
                source: "email_analysis".to_string(),
                generated: true,
                created_at: now,
                updated_at: now,
                span_start: None,
                span_end: None,
                confidence: Some(4),
                source_location: None,
                insight_type: Some(model::insight_context::InsightType::Actionable),
                relevance_keywords: Some(vec![
                    "meetings".to_string(),
                    "morning".to_string(),
                    "slack".to_string(),
                    "communication".to_string(),
                    "preferences".to_string(),
                ]),
            },
            // Insight with single keyword
            UserInsightRecord {
                id: None,
                user_id: "macro|user2@macro.com".to_string(),
                content: "User is a software developer".to_string(),
                source: "profile_analysis".to_string(),
                generated: true,
                created_at: now,
                updated_at: now,
                span_start: None,
                span_end: None,
                confidence: Some(5),
                source_location: None,
                insight_type: Some(model::insight_context::InsightType::Informational),
                relevance_keywords: Some(vec!["developer".to_string()]),
            },
            // Insight with no keywords (None)
            UserInsightRecord {
                id: None,
                user_id: "macro|user2@macro.com".to_string(),
                content: "User behavior pattern detected".to_string(),
                source: "behavior_analysis".to_string(),
                generated: true,
                created_at: now,
                updated_at: now,
                span_start: None,
                span_end: None,
                confidence: Some(3),
                source_location: None,
                insight_type: Some(model::insight_context::InsightType::Trend),
                relevance_keywords: None,
            },
            // Insight with empty array
            UserInsightRecord {
                id: None,
                user_id: "macro|user2@macro.com".to_string(),
                content: "Empty keywords test".to_string(),
                source: "test_source".to_string(),
                generated: false,
                created_at: now,
                updated_at: now,
                span_start: None,
                span_end: None,
                confidence: Some(2),
                source_location: None,
                insight_type: Some(model::insight_context::InsightType::Warning),
                relevance_keywords: Some(vec![]),
            },
        ];

        // Create all insights at once
        let ids = create_insights(&pool, &insights, "macro|user2@macro.com").await?;
        assert_eq!(ids.len(), 4);

        // Verify each insight was stored correctly by fetching from database
        for (i, id) in ids.iter().enumerate() {
            let stored = get_insight(&pool, id, "macro|user2@macro.com").await?;
            assert!(stored.is_some());
            let stored = stored.unwrap();

            // Verify the relevance_keywords array matches what we inserted
            match i {
                0 => {
                    // Multiple keywords case
                    let keywords = stored.relevance_keywords.as_ref().unwrap();
                    assert_eq!(keywords.len(), 5);
                    assert!(keywords.contains(&"meetings".to_string()));
                    assert!(keywords.contains(&"morning".to_string()));
                    assert!(keywords.contains(&"slack".to_string()));
                    assert!(keywords.contains(&"communication".to_string()));
                    assert!(keywords.contains(&"preferences".to_string()));
                    assert_eq!(
                        stored.insight_type,
                        Some(model::insight_context::InsightType::Actionable)
                    );
                }
                1 => {
                    // Single keyword case
                    let keywords = stored.relevance_keywords.as_ref().unwrap();
                    assert_eq!(keywords.len(), 1);
                    assert_eq!(keywords[0], "developer");
                    assert_eq!(
                        stored.insight_type,
                        Some(model::insight_context::InsightType::Informational)
                    );
                }
                2 => {
                    // None keywords case
                    assert!(stored.relevance_keywords.is_none());
                    assert_eq!(
                        stored.insight_type,
                        Some(model::insight_context::InsightType::Trend)
                    );
                }
                3 => {
                    // Empty array case
                    let keywords = stored.relevance_keywords.as_ref().unwrap();
                    assert_eq!(keywords.len(), 0);
                    assert_eq!(
                        stored.insight_type,
                        Some(model::insight_context::InsightType::Warning)
                    );
                }
                _ => unreachable!(),
            }
        }

        // Test direct database query to verify array storage
        let raw_results = sqlx::query!(
            r#"SELECT content, "relevanceKeywords", "insightType" FROM "UserInsights" WHERE id = ANY($1) ORDER BY content"#,
            &ids
        )
        .fetch_all(&pool)
        .await?;

        assert_eq!(raw_results.len(), 4);

        // Verify the first result (multiple keywords) directly from DB
        let first_result = &raw_results[3]; // "User prefers morning meetings..." (sorted by content)
        assert!(first_result.relevanceKeywords.is_some());
        let db_keywords = first_result.relevanceKeywords.as_ref().unwrap();
        assert_eq!(db_keywords.len(), 5);
        assert_eq!(first_result.insightType.as_ref().unwrap(), "actionable");

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../fixtures"))]
    async fn test_create_insights_with_span_data(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Insert a user for FK constraint
        sqlx::query!(
            r#"INSERT INTO "User" (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING"#,
            "macro|user3@macro.com",
            "user3@macro.com"
        )
        .execute(&pool)
        .await?;

        let now = Utc::now();
        let span_start_time = now - chrono::Duration::hours(2);
        let span_end_time = now - chrono::Duration::hours(1);
        let insight = UserInsightRecord {
            id: None,
            user_id: "macro|user3@macro.com".to_string(),
            content: "Test content with span data".to_string(),
            source: "test_source".to_string(),
            generated: true,
            created_at: now,
            updated_at: now,
            span_start: Some(span_start_time),
            span_end: Some(span_end_time),
            confidence: Some(4),
            source_location: None,
            insight_type: Some(model::insight_context::InsightType::Actionable),
            relevance_keywords: Some(vec!["span".to_string(), "test".to_string()]),
        };

        let ids = create_insights(&pool, &vec![insight.clone()], &insight.user_id).await?;
        assert_eq!(ids.len(), 1);

        // Verify span data was stored correctly
        let rec = sqlx::query!(
            r#"SELECT content, "spanStart", "spanEnd" FROM "UserInsights" WHERE id = $1"#,
            ids[0]
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(rec.content, insight.content);
        assert!(rec.spanStart.is_some());
        assert!(rec.spanEnd.is_some());

        // Test with get_insight to ensure round-trip works
        let found = get_insight(&pool, &ids[0], &insight.user_id).await?;
        assert!(found.is_some());
        let found = found.unwrap();
        assert!(found.span_start.is_some());
        assert!(found.span_end.is_some());

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../fixtures"))]
    async fn test_create_insights_with_null_span_data(pool: Pool<Postgres>) -> anyhow::Result<()> {
        // Insert a user for FK constraint
        sqlx::query!(
            r#"INSERT INTO "User" (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING"#,
            "macro|user4@macro.com",
            "user4@macro.com"
        )
        .execute(&pool)
        .await?;

        let now = Utc::now();
        let insight = UserInsightRecord {
            id: None,
            user_id: "macro|user4@macro.com".to_string(),
            content: "Test content without span data".to_string(),
            source: "test_source".to_string(),
            generated: true,
            created_at: now,
            updated_at: now,
            span_start: None,
            span_end: None,
            confidence: Some(3),
            source_location: None,
            insight_type: Some(model::insight_context::InsightType::Informational),
            relevance_keywords: Some(vec!["no_span".to_string()]),
        };

        let ids = create_insights(&pool, &vec![insight.clone()], &insight.user_id).await?;
        assert_eq!(ids.len(), 1);

        // Verify NULL span data was stored correctly
        let rec = sqlx::query!(
            r#"SELECT content, "spanStart", "spanEnd" FROM "UserInsights" WHERE id = $1"#,
            ids[0]
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(rec.content, insight.content);
        assert!(rec.spanStart.is_none());
        assert!(rec.spanEnd.is_none());

        // Test with get_insight to ensure round-trip works
        let found = get_insight(&pool, &ids[0], &insight.user_id).await?;
        assert!(found.is_some());
        let found = found.unwrap();
        assert!(found.span_start.is_none());
        assert!(found.span_end.is_none());

        Ok(())
    }
}
