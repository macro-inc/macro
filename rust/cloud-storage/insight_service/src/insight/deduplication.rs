use anyhow::Result;
use model::insight_context::UserInsightRecord;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

/// Configuration for deduplication behavior
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct DeduplicationConfig {
    /// Enable exact content hash matching
    pub exact_match_enabled: bool,
    /// Minimum similarity threshold for semantic comparison (0.0-1.0)
    pub semantic_similarity_threshold: f32,
    /// Maximum edit distance for fuzzy matching
    pub edit_distance_threshold: usize,
    /// Weight for source location overlap in similarity calculation
    pub source_location_weight: f32,
    /// Weight for confidence score difference in similarity calculation
    pub confidence_weight: f32,
    /// Enable LLM-based final decision for edge cases
    pub llm_fallback_enabled: bool,
}

impl Default for DeduplicationConfig {
    fn default() -> Self {
        Self {
            exact_match_enabled: true,
            semantic_similarity_threshold: 0.85,
            edit_distance_threshold: 10,
            source_location_weight: 0.3,
            confidence_weight: 0.2,
            llm_fallback_enabled: true,
        }
    }
}

/// Similarity metrics between two insights
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct SimilarityScore {
    pub exact_match: bool,
    pub content_similarity: f32,
    pub edit_distance: usize,
    pub token_overlap: f32,
    pub source_overlap: f32,
    pub confidence_diff: i32,
    pub overall_score: f32,
}

/// Multi-layer insight deduplication system
pub struct InsightDeduplicator {
    config: DeduplicationConfig,
}

impl InsightDeduplicator {
    pub fn new(config: DeduplicationConfig) -> Self {
        Self { config }
    }

    /// Deduplicate insights using multi-layer approach
    pub async fn deduplicate_insights(
        &self,
        new_insights: &[UserInsightRecord],
        existing_insights: &[UserInsightRecord],
    ) -> Result<Vec<UserInsightRecord>> {
        let mut deduplicated = Vec::new();
        let existing_by_hash = self.build_hash_index(existing_insights);

        for new_insight in new_insights {
            if self
                .should_keep_insight(new_insight, existing_insights, &existing_by_hash)
                .await?
            {
                deduplicated.push(new_insight.clone());
            } else {
                tracing::debug!(
                    insight_id = ?new_insight.id,
                    content = %new_insight.content,
                    "Insight filtered as duplicate"
                );
            }
        }

        Ok(deduplicated)
    }

    /// Determine if an insight should be kept based on similarity analysis
    async fn should_keep_insight(
        &self,
        new_insight: &UserInsightRecord,
        existing_insights: &[UserInsightRecord],
        existing_by_hash: &HashMap<String, &UserInsightRecord>,
    ) -> Result<bool> {
        // Layer 1: Exact content hash matching (fastest)
        if self.config.exact_match_enabled {
            let content_hash = self.calculate_content_hash(&new_insight.content);
            if existing_by_hash.contains_key(&content_hash) {
                tracing::debug!("Exact content match found, filtering duplicate");
                return Ok(false);
            }
        }

        // Layer 2: Find semantically similar insights
        let similar_insights = self.find_similar_insights(new_insight, existing_insights);

        if similar_insights.is_empty() {
            return Ok(true); // No similar insights found, keep it
        }

        // Layer 3: Analyze similarity scores
        let mut max_similarity = 0.0f32;
        let mut most_similar_insight = None;

        for (insight, similarity) in &similar_insights {
            if similarity.overall_score > max_similarity {
                max_similarity = similarity.overall_score;
                most_similar_insight = Some(*insight);
            }
        }

        // If similarity is below threshold, keep the insight
        if max_similarity < self.config.semantic_similarity_threshold {
            return Ok(true);
        }

        // Layer 4: LLM-based decision for edge cases (if enabled)
        if self.config.llm_fallback_enabled && max_similarity > 0.9 {
            return self
                .llm_deduplication_decision(new_insight, most_similar_insight.unwrap())
                .await;
        }

        // Filter high-similarity insights
        tracing::debug!(
            similarity_score = %max_similarity,
            threshold = %self.config.semantic_similarity_threshold,
            "Filtering insight based on similarity threshold"
        );
        Ok(false)
    }

    /// Build hash index for fast exact matching
    fn build_hash_index<'a>(
        &self,
        insights: &'a [UserInsightRecord],
    ) -> HashMap<String, &'a UserInsightRecord> {
        insights
            .iter()
            .map(|insight| (self.calculate_content_hash(&insight.content), insight))
            .collect()
    }

    /// Calculate normalized content hash
    fn calculate_content_hash(&self, content: &str) -> String {
        let normalized = self.normalize_content(content);
        let mut hasher = Sha256::new();
        hasher.update(normalized.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Normalize content for better comparison
    fn normalize_content(&self, content: &str) -> String {
        content
            .to_lowercase()
            .chars()
            .filter(|c| c.is_alphanumeric() || c.is_whitespace())
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Find insights with similarity above threshold
    fn find_similar_insights<'a>(
        &self,
        new_insight: &UserInsightRecord,
        existing_insights: &'a [UserInsightRecord],
    ) -> Vec<(&'a UserInsightRecord, SimilarityScore)> {
        existing_insights
            .iter()
            .map(|existing| (existing, self.calculate_similarity(new_insight, existing)))
            .filter(|(_, similarity)| similarity.overall_score > 0.5) // Pre-filter low similarity
            .collect()
    }

    /// Calculate comprehensive similarity score between two insights
    fn calculate_similarity(
        &self,
        insight1: &UserInsightRecord,
        insight2: &UserInsightRecord,
    ) -> SimilarityScore {
        let normalized1 = self.normalize_content(&insight1.content);
        let normalized2 = self.normalize_content(&insight2.content);

        // Exact match check
        let exact_match = normalized1 == normalized2;

        // Edit distance calculation
        let edit_distance = self.calculate_edit_distance(&normalized1, &normalized2);

        // Token overlap calculation
        let tokens1: HashSet<&str> = normalized1.split_whitespace().collect();
        let tokens2: HashSet<&str> = normalized2.split_whitespace().collect();
        let intersection_size = tokens1.intersection(&tokens2).count();
        let union_size = tokens1.union(&tokens2).count();
        let token_overlap = if union_size > 0 {
            intersection_size as f32 / union_size as f32
        } else {
            0.0
        };

        // Content similarity based on token overlap and edit distance
        let max_len = normalized1.len().max(normalized2.len()) as f32;
        let content_similarity = if max_len > 0.0 {
            1.0 - (edit_distance as f32 / max_len)
        } else {
            0.0
        };

        // Source location overlap
        let source_overlap = self.calculate_source_overlap(insight1, insight2);

        // Confidence score difference
        let confidence_diff = match (insight1.confidence, insight2.confidence) {
            (Some(c1), Some(c2)) => (c1 - c2).abs(),
            _ => 0,
        };

        // Calculate weighted overall score
        // Base score from content and tokens, then boost from source overlap, then penalize for confidence diff
        let base_score = content_similarity * 0.6 + token_overlap * 0.4;
        let source_boost = source_overlap * self.config.source_location_weight;
        let confidence_penalty = (confidence_diff as f32 / 5.0) * self.config.confidence_weight;
        let overall_score = base_score + source_boost - confidence_penalty;

        SimilarityScore {
            exact_match,
            content_similarity,
            edit_distance,
            token_overlap,
            source_overlap,
            confidence_diff,
            overall_score: overall_score.clamp(0.0, 1.0),
        }
    }

    /// Calculate edit distance between two strings
    #[expect(
        clippy::needless_range_loop,
        reason = "clippy's suggestion here is bad"
    )]
    fn calculate_edit_distance(&self, s1: &str, s2: &str) -> usize {
        let len1 = s1.len();
        let len2 = s2.len();
        let mut matrix = vec![vec![0; len2 + 1]; len1 + 1];

        // Initialize first row and column
        for i in 0..=len1 {
            matrix[i][0] = i;
        }
        for j in 0..=len2 {
            matrix[0][j] = j;
        }

        // Fill the matrix
        for (i, c1) in s1.chars().enumerate() {
            for (j, c2) in s2.chars().enumerate() {
                let cost = if c1 == c2 { 0 } else { 1 };
                matrix[i + 1][j + 1] = std::cmp::min(
                    std::cmp::min(
                        matrix[i][j + 1] + 1, // Deletion
                        matrix[i + 1][j] + 1, // Insertion
                    ),
                    matrix[i][j] + cost, // Substitution
                );
            }
        }

        matrix[len1][len2]
    }

    /// Calculate source location overlap
    fn calculate_source_overlap(
        &self,
        insight1: &UserInsightRecord,
        insight2: &UserInsightRecord,
    ) -> f32 {
        use model::insight_context::SourceLocation;

        match (&insight1.source_location, &insight2.source_location) {
            (Some(SourceLocation::Email(loc1)), Some(SourceLocation::Email(loc2))) => {
                let thread_overlap = self.calculate_set_overlap(&loc1.thread_ids, &loc2.thread_ids);
                let message_overlap =
                    self.calculate_set_overlap(&loc1.message_ids, &loc2.message_ids);
                (thread_overlap + message_overlap) / 2.0
            }
            (None, None) => 0.0, // No location data
            _ => 0.0,            // One has location, other doesn't, or different types
        }
    }

    /// Calculate overlap between two sets of strings
    fn calculate_set_overlap(&self, set1: &[String], set2: &[String]) -> f32 {
        if set1.is_empty() && set2.is_empty() {
            return 0.0;
        }

        let s1: HashSet<&String> = set1.iter().collect();
        let s2: HashSet<&String> = set2.iter().collect();
        let intersection_size = s1.intersection(&s2).count();
        let union_size = s1.union(&s2).count();

        if union_size > 0 {
            intersection_size as f32 / union_size as f32
        } else {
            0.0
        }
    }

    /// LLM-based deduplication decision for edge cases
    async fn llm_deduplication_decision(
        &self,
        _new_insight: &UserInsightRecord,
        _existing_insight: &UserInsightRecord,
    ) -> Result<bool> {
        // TODO: Implement LLM call for edge cases
        // This would use a focused prompt comparing just two insights
        // For now, return conservative decision
        tracing::debug!(
            "LLM fallback deduplication not yet implemented, using conservative approach"
        );
        Ok(false) // Conservative: filter as duplicate
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use model::insight_context::{EmailSourceLocation, SourceLocation};

    fn create_test_insight(content: &str, confidence: Option<i32>) -> UserInsightRecord {
        UserInsightRecord {
            id: None,
            user_id: "test_user".to_string(),
            content: content.to_string(),
            confidence,
            generated: true,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            source: "test".to_string(),
            source_location: None,
            span_start: None,
            span_end: None,
            insight_type: None,
            relevance_keywords: None,
        }
    }

    #[test]
    fn test_exact_content_matching() {
        let deduplicator = InsightDeduplicator::new(DeduplicationConfig::default());

        let insight1 = create_test_insight("User prefers morning meetings", Some(4));
        let insight2 = create_test_insight("User prefers morning meetings", Some(4));

        let similarity = deduplicator.calculate_similarity(&insight1, &insight2);
        assert!(similarity.exact_match);
        assert!(similarity.overall_score > 0.9);
    }

    #[test]
    fn test_fuzzy_content_matching() {
        let deduplicator = InsightDeduplicator::new(DeduplicationConfig::default());

        let insight1 = create_test_insight("User prefers morning meetings", Some(4));
        let insight2 = create_test_insight("User likes morning meetings", Some(4));

        let similarity = deduplicator.calculate_similarity(&insight1, &insight2);
        assert!(!similarity.exact_match);
        assert!(similarity.overall_score > 0.7); // High similarity
        assert!(similarity.token_overlap >= 0.6);
    }

    #[test]
    fn test_different_insights() {
        let deduplicator = InsightDeduplicator::new(DeduplicationConfig::default());

        let insight1 = create_test_insight("User prefers morning meetings", Some(4));
        let insight2 = create_test_insight("User enjoys reading technical documentation", Some(3));

        let similarity = deduplicator.calculate_similarity(&insight1, &insight2);
        assert!(!similarity.exact_match);
        assert!(similarity.overall_score < 0.3); // Low similarity
    }

    #[test]
    fn test_source_location_overlap() {
        let deduplicator = InsightDeduplicator::new(DeduplicationConfig::default());

        let mut insight1 = create_test_insight("User prefers morning meetings", Some(4));
        let mut insight2 = create_test_insight("User likes morning meetings", Some(4));

        // Add overlapping source locations
        let source_loc = SourceLocation::Email(EmailSourceLocation {
            thread_ids: vec!["thread1".to_string(), "thread2".to_string()],
            message_ids: vec!["msg1".to_string()],
            email_addresses: None,
        });

        insight1.source_location = Some(source_loc.clone());
        insight2.source_location = Some(source_loc);

        let similarity = deduplicator.calculate_similarity(&insight1, &insight2);
        assert_eq!(similarity.source_overlap, 1.0); // Perfect overlap
    }

    #[tokio::test]
    async fn test_deduplication_pipeline() {
        let mut config = DeduplicationConfig::default();
        config.semantic_similarity_threshold = 0.5; // Lower threshold to catch the similar insight
        let deduplicator = InsightDeduplicator::new(config);

        let existing_insights = vec![
            create_test_insight("User prefers morning meetings", Some(4)),
            create_test_insight("User enjoys coding in Rust", Some(5)),
        ];

        let new_insights = vec![
            create_test_insight("User prefers morning meetings", Some(4)), // Exact duplicate
            create_test_insight("User likes morning meetings", Some(4)), // Similar (59% similarity)
            create_test_insight("User reads books in the evening", Some(3)), // Different - should be kept
        ];

        let result = deduplicator
            .deduplicate_insights(&new_insights, &existing_insights)
            .await
            .unwrap();

        // Should filter exact duplicate and similar insight, keep only the different one
        assert_eq!(result.len(), 1);
        assert!(result[0].content.contains("evening"));
    }

    #[tokio::test]
    async fn test_deduplication_with_more_similar_content() {
        let mut config = DeduplicationConfig::default();
        config.semantic_similarity_threshold = 0.8; // Lower threshold to catch the "improved" variant
        let deduplicator = InsightDeduplicator::new(config);

        let existing_insights = vec![create_test_insight(
            "User prefers morning meetings for better productivity",
            Some(4),
        )];

        let new_insights = vec![
            create_test_insight(
                "User prefers morning meetings for better productivity",
                Some(4),
            ), // Exact
            create_test_insight(
                "User prefers morning meetings for improved productivity",
                Some(4),
            ), // Very similar
            create_test_insight("User enjoys evening walks", Some(3)), // Different
        ];

        let result = deduplicator
            .deduplicate_insights(&new_insights, &existing_insights)
            .await
            .unwrap();

        // Should keep only the different insight
        assert_eq!(result.len(), 1);
        assert!(result[0].content.contains("evening"));
    }
}
