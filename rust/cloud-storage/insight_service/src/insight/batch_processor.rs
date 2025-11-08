use crate::insight::smart_ranking::{RankingContext, select_insights_for_llm_context};
use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use macro_db_client::insight::user as user_insight;
use sqlx::PgPool;

/// Default target tokens for insight batch
const DEFAULT_TARGET_TOKENS: usize = 2048;

/// Default batch expiration duration (7 days)
const DEFAULT_BATCH_EXPIRATION_DAYS: i64 = 7;

/// Get target tokens from environment or use default
fn get_target_tokens() -> usize {
    std::env::var("INSIGHT_BATCH_TARGET_TOKENS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_TARGET_TOKENS)
}

/// Get batch expiration days from environment or use default
fn get_batch_expiration_days() -> i64 {
    std::env::var("INSIGHT_BATCH_EXPIRATION_DAYS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_BATCH_EXPIRATION_DAYS)
}

/// Default maximum insights to fetch per user
const DEFAULT_MAX_INSIGHTS: i64 = 1000;

/// Get the maximum insights limit from environment or use default
fn get_max_insights_limit() -> i64 {
    std::env::var("INSIGHT_BATCH_MAX_INSIGHTS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_MAX_INSIGHTS)
}

/// Daily job to generate insight batches for users
pub struct InsightBatchProcessor {
    macro_db: PgPool,
}

impl InsightBatchProcessor {
    pub fn new(macro_db: PgPool) -> Self {
        Self { macro_db }
    }

    /// Process all users who need updated insight batches
    #[tracing::instrument(skip(self))]
    pub async fn process_all_users(&self, batch_size: i64) -> Result<ProcessingStats> {
        let mut stats = ProcessingStats::default();

        tracing::info!("Starting daily insight batch processing");

        // Clean up expired batches first
        let expired_count = user_insight::delete_expired_insight_batches(&self.macro_db)
            .await
            .context("Failed to clean up expired batches")?;

        tracing::info!("Cleaned up {} expired insight batches", expired_count);
        stats.expired_cleaned = expired_count;

        // Get users who need batch refresh
        let user_ids = user_insight::get_users_needing_batch_refresh(&self.macro_db, batch_size)
            .await
            .context("Failed to get users needing batch refresh")?;

        tracing::info!(
            "Found {} users needing insight batch refresh",
            user_ids.len()
        );

        // Process each user
        for user_id in &user_ids {
            match self.process_user_batch(user_id).await {
                Ok(_) => {
                    stats.users_processed += 1;
                    tracing::debug!("Successfully processed batch for user {}", user_id);
                }
                Err(e) => {
                    stats.users_failed += 1;
                    tracing::error!(
                        error = ?e,
                        user_id = %user_id,
                        "Failed to process batch for user"
                    );
                }
            }
        }

        tracing::info!(
            "Batch processing complete. Processed: {}, Failed: {}, Expired cleaned: {}",
            stats.users_processed,
            stats.users_failed,
            stats.expired_cleaned
        );

        Ok(stats)
    }

    /// Process insight batch for a single user
    #[tracing::instrument(skip(self))]
    pub async fn process_user_batch(&self, user_id: &str) -> Result<()> {
        // Get all generated insights for user
        let max_insights = get_max_insights_limit() as u32;
        let all_insights = user_insight::get_user_insights(
            &self.macro_db,
            user_id,
            Some(true), // Only generated insights
            max_insights,
            0,
        )
        .await
        .context("Failed to fetch user insights")?;

        if all_insights.is_empty() {
            tracing::debug!("No insights found for user {}", user_id);
            return Ok(());
        }

        // Set up ranking context for smart selection
        let ranking_context = RankingContext {
            current_time: Utc::now(),
            query_keywords: None,    // Could be enhanced with user preferences
            max_insights: 50,        // Allow up to 50 insights to be considered
            prefer_actionable: true, // Prioritize actionable insights
        };

        // Use smart ranking to select best insights within token budget
        let selected_insights =
            select_insights_for_llm_context(&all_insights, &ranking_context, get_target_tokens());

        if selected_insights.is_empty() {
            tracing::warn!("No insights selected for user {}", user_id);
            return Ok(());
        }

        // Calculate stats
        let insight_ids: Vec<String> = selected_insights
            .iter()
            .filter_map(|i| i.id.clone())
            .collect();

        let total_chars: usize = selected_insights.iter().map(|i| i.content.len()).sum();

        let estimated_tokens = total_chars / 4;

        // Create expiration time
        let expires_at = Utc::now() + Duration::days(get_batch_expiration_days());

        // Store ranking context for debugging/analytics
        let ranking_context_json = serde_json::json!({
            "target_tokens": get_target_tokens(),
            "prefer_actionable": ranking_context.prefer_actionable,
            "selection_time": ranking_context.current_time,
            "total_insights_considered": all_insights.len(),
            "insights_selected": insight_ids.len()
        });

        // Upsert the batch
        let batch_id = user_insight::upsert_user_insight_batch(
            &self.macro_db,
            user_id,
            &insight_ids,
            total_chars as i32,
            estimated_tokens as i32,
            expires_at,
            Some(&ranking_context_json),
        )
        .await
        .context("Failed to upsert insight batch")?;

        tracing::info!(
            "Created insight batch {} for user {} with {} insights ({} chars, ~{} tokens)",
            batch_id,
            user_id,
            insight_ids.len(),
            total_chars,
            estimated_tokens
        );

        Ok(())
    }

    /// Process a single user immediately (for API triggered processing)
    pub async fn process_user_immediate(&self, user_id: &str) -> Result<()> {
        self.process_user_batch(user_id).await
    }
}

#[derive(Debug, Default)]
pub struct ProcessingStats {
    pub users_processed: u64,
    pub users_failed: u64,
    pub expired_cleaned: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use model::insight_context::{InsightType, UserInsightRecord};

    fn create_test_insight(
        id: &str,
        content: &str,
        confidence: i32,
        insight_type: InsightType,
    ) -> UserInsightRecord {
        UserInsightRecord {
            id: Some(id.to_string()),
            user_id: "test_user".to_string(),
            content: content.to_string(),
            confidence: Some(confidence),
            generated: true,
            source: "email".to_string(),
            source_location: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            span_start: None,
            span_end: None,
            insight_type: Some(insight_type),
            relevance_keywords: Some(vec!["test".to_string()]),
        }
    }

    #[test]
    fn test_target_token_calculation() {
        // Test that our target is reasonable
        assert_eq!(get_target_tokens(), 2048);

        // With default 4 chars per token, we get 8192 characters
        let target_chars = get_target_tokens() * 4;
        assert_eq!(target_chars, 8192);

        // Should fit roughly 40-50 insights of ~150-200 chars each
        let avg_insight_chars = 175;
        let expected_insights = target_chars / avg_insight_chars;
        assert!(expected_insights >= 40 && expected_insights <= 50);
    }

    #[test]
    fn test_insights_selection_prioritizes_actionable() {
        let insights = vec![
            create_test_insight(
                "1",
                "Low confidence informational",
                30,
                InsightType::Informational,
            ),
            create_test_insight(
                "2",
                "High confidence actionable",
                90,
                InsightType::Actionable,
            ),
            create_test_insight("3", "Medium confidence warning", 70, InsightType::Warning),
        ];

        let context = RankingContext {
            current_time: Utc::now(),
            query_keywords: None,
            max_insights: 10,
            prefer_actionable: true,
        };

        let selected = select_insights_for_llm_context(&insights, &context, 1000);

        // Should prefer the actionable insight first due to high confidence + actionable type
        assert!(!selected.is_empty());
        assert_eq!(selected[0].id.as_ref().unwrap(), "2");
    }
}
