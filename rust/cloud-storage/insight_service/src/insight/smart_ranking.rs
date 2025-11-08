use chrono::{DateTime, Duration, Utc};
use model::insight_context::{InsightType, UserInsightRecord};

/// Default characters per token estimation
const DEFAULT_CHARS_PER_TOKEN: usize = 4;

/// Get characters per token from environment or use default
fn get_chars_per_token() -> usize {
    std::env::var("INSIGHT_CHARS_PER_TOKEN_ESTIMATE")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_CHARS_PER_TOKEN)
}

#[derive(Debug, Clone)]
pub struct RankingContext {
    pub current_time: DateTime<Utc>,
    pub query_keywords: Option<Vec<String>>, // keywords to match against relevance_keywords
    pub max_insights: usize,
    pub prefer_actionable: bool, // prioritize actionable insights
}

impl Default for RankingContext {
    fn default() -> Self {
        Self {
            current_time: Utc::now(),
            query_keywords: None,
            max_insights: 20,
            prefer_actionable: false,
        }
    }
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct InsightScore {
    pub insight_id: String,
    pub total_score: f32,
    pub breakdown: ScoreBreakdown,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ScoreBreakdown {
    pub recency_score: f32,
    pub confidence_score: f32,
    pub type_bonus: f32,
    pub keyword_match_score: f32,
}

/// Smart insight ranking algorithm for LLM context selection
pub fn rank_insights_for_context(
    insights: &[UserInsightRecord],
    context: &RankingContext,
) -> Vec<InsightScore> {
    let mut scores: Vec<InsightScore> = insights
        .iter()
        .map(|insight| calculate_insight_score(insight, context))
        .collect();

    // Sort by total score descending
    scores.sort_by(|a, b| b.total_score.partial_cmp(&a.total_score).unwrap());

    // Return top N insights
    scores.into_iter().take(context.max_insights).collect()
}

fn calculate_insight_score(insight: &UserInsightRecord, context: &RankingContext) -> InsightScore {
    let recency_score = calculate_recency_score(insight, context.current_time);
    let confidence_score = insight.confidence.unwrap_or(50) as f32 / 100.0;
    let type_bonus = calculate_type_bonus(insight, context);
    let keyword_match_score = calculate_keyword_match_score(insight, context);

    // Simple weighted combination: confidence + recency + type + keywords
    let total_score = (confidence_score * 0.4) +  // Most important: how confident/accurate
                     (recency_score * 0.3) +      // Second: how recent
                     (type_bonus * 0.2) +         // Third: insight type (actionable > warning > info)
                     (keyword_match_score * 0.1); // Fourth: keyword relevance

    InsightScore {
        insight_id: insight.id.clone().unwrap_or_default(),
        total_score,
        breakdown: ScoreBreakdown {
            recency_score,
            confidence_score,
            type_bonus,
            keyword_match_score,
        },
    }
}

fn calculate_recency_score(insight: &UserInsightRecord, current_time: DateTime<Utc>) -> f32 {
    // prefer span_start over created_at since it represents the insight source creation time (not the insight creation time)
    let age = current_time.signed_duration_since(insight.span_start.unwrap_or(insight.created_at));

    // Decay function: newer insights score higher
    if age <= Duration::days(1) {
        1.0
    } else if age <= Duration::days(7) {
        0.8
    } else if age <= Duration::days(30) {
        0.6
    } else if age <= Duration::days(90) {
        0.4
    } else {
        0.2
    }
}

fn calculate_type_bonus(insight: &UserInsightRecord, context: &RankingContext) -> f32 {
    match &insight.insight_type {
        Some(InsightType::Actionable) => {
            if context.prefer_actionable {
                1.0
            } else {
                0.8
            }
        }
        Some(InsightType::Warning) => 0.7,
        Some(InsightType::Trend) => 0.6,
        Some(InsightType::Informational) => 0.5,
        None => 0.5, // Default for unclassified insights
    }
}

fn calculate_keyword_match_score(insight: &UserInsightRecord, context: &RankingContext) -> f32 {
    let Some(query_keywords) = &context.query_keywords else {
        return 0.5; // Default score when no keywords to match
    };

    let Some(insight_keywords) = &insight.relevance_keywords else {
        return 0.3; // Lower score for insights without keywords
    };

    // Simple keyword matching - count how many query keywords match insight keywords
    let matches = query_keywords
        .iter()
        .filter(|query_kw| {
            insight_keywords
                .iter()
                .any(|insight_kw| insight_kw.to_lowercase().contains(&query_kw.to_lowercase()))
        })
        .count();

    if matches == 0 {
        0.2
    } else {
        // Score based on match ratio (capped at 1.0)
        (matches as f32 / query_keywords.len() as f32).min(1.0)
    }
}

/// Select best insights considering token budget constraints
pub fn select_insights_for_llm_context(
    insights: &[UserInsightRecord],
    context: &RankingContext,
    max_tokens: usize,
) -> Vec<UserInsightRecord> {
    let ranked_scores = rank_insights_for_context(insights, context);
    let mut selected_insights = Vec::new();
    let mut token_count = 0;

    for score in ranked_scores {
        if let Some(insight) = insights
            .iter()
            .find(|i| i.id.as_ref() == Some(&score.insight_id))
        {
            // Configurable token estimation
            let insight_tokens = insight.content.len() / get_chars_per_token();

            if token_count + insight_tokens <= max_tokens {
                selected_insights.push(insight.clone());
                token_count += insight_tokens;
            } else {
                break;
            }
        }
    }

    selected_insights
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn test_recency_scoring() {
        let now = Utc::now();
        let insight = UserInsightRecord {
            id: Some("test".to_string()),
            user_id: "user1".to_string(),
            content: "test insight".to_string(),
            created_at: now - Duration::hours(2),
            updated_at: now,
            confidence: Some(80),
            generated: true,
            source: "email".to_string(),
            source_location: None,
            span_start: None,
            span_end: None,
            insight_type: None,
            relevance_keywords: None,
        };

        let score = calculate_recency_score(&insight, now);
        assert_eq!(score, 1.0); // Should be max score for recent insight
    }

    #[test]
    fn test_insight_ranking() {
        let insights = vec![
            UserInsightRecord {
                id: Some("high_conf".to_string()),
                confidence: Some(90),
                created_at: Utc::now() - Duration::hours(1),
                content: "High confidence insight".to_string(),
                user_id: "user1".to_string(),
                updated_at: Utc::now(),
                generated: true,
                source: "email".to_string(),
                source_location: None,
                span_start: None,
                span_end: None,
                insight_type: Some(InsightType::Actionable),
                relevance_keywords: Some(vec!["email".to_string(), "urgent".to_string()]),
            },
            UserInsightRecord {
                id: Some("low_conf".to_string()),
                confidence: Some(30),
                created_at: Utc::now() - Duration::days(1),
                content: "Low confidence insight".to_string(),
                user_id: "user1".to_string(),
                updated_at: Utc::now(),
                generated: true,
                source: "email".to_string(),
                source_location: None,
                span_start: None,
                span_end: None,
                insight_type: Some(InsightType::Informational),
                relevance_keywords: None,
            },
        ];

        let context = RankingContext {
            current_time: Utc::now(),
            query_keywords: Some(vec!["email".to_string()]),
            max_insights: 2,
            prefer_actionable: true,
        };

        let ranked = rank_insights_for_context(&insights, &context);

        // High confidence + recent + actionable type + keyword match should rank higher
        assert!(ranked[0].total_score > ranked[1].total_score);
        assert_eq!(ranked[0].insight_id, "high_conf");
    }

    #[test]
    fn test_keyword_matching() {
        let insight = UserInsightRecord {
            id: Some("test".to_string()),
            user_id: "user1".to_string(),
            content: "test".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            confidence: Some(50),
            generated: true,
            source: "email".to_string(),
            source_location: None,
            span_start: None,
            span_end: None,
            insight_type: None,
            relevance_keywords: Some(vec![
                "email".to_string(),
                "urgent".to_string(),
                "project".to_string(),
            ]),
        };

        let context = RankingContext {
            current_time: Utc::now(),
            query_keywords: Some(vec!["email".to_string(), "project".to_string()]),
            max_insights: 10,
            prefer_actionable: false,
        };

        let score = calculate_keyword_match_score(&insight, &context);
        assert_eq!(score, 1.0); // Perfect match: 2 out of 2 keywords match
    }
}
