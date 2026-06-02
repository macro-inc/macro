//! Ports for the task duplicate detection pipeline.
//!
//! Embedding, reranking, and vector storage are provided by the [`embedding`]
//! crate's traits ([`EmbeddingModel`](embedding::EmbeddingModel),
//! [`RerankModel`](embedding::RerankModel), [`VectorDb`](embedding::VectorDb)) and
//! injected into [`TaskDedupService`](crate::domain::service::TaskDedupService) as
//! generic type parameters. The ports defined here cover only the
//! task-duplicate-specific concerns the embedding crate does not: judging,
//! match-state persistence, and live notifications.

use std::collections::HashMap;

use async_trait::async_trait;
use uuid::Uuid;

use super::models::{JudgeResult, TaskDedupError, TaskDuplicate};

/// Applies a semantic duplicate judgement after vector retrieval and reranking.
#[async_trait]
pub trait TaskDuplicateJudge: Send + Sync {
    /// Judges whether `left` and `right` represent the same task.
    async fn judge(&self, left: &str, right: &str) -> JudgeResult;
}

/// Persists and queries duplicate match state.
///
/// Embeddings and candidate retrieval live behind the embedding crate's
/// [`VectorDb`](embedding::VectorDb); this port owns the match graph that vector
/// search feeds into.
#[async_trait]
pub trait TaskMatchRepo: Send + Sync {
    /// Upserts an active duplicate match.
    async fn upsert_match(
        &self,
        task_id: &str,
        duplicate_task_id: &str,
        similarity_score: f64,
        judge_model: Option<&str>,
        judge_reason: Option<&str>,
    ) -> Result<(), TaskDedupError>;

    /// Returns all active documents connected to any seed document through
    /// active duplicate matches.
    async fn active_duplicate_component(
        &self,
        document_ids: &[String],
    ) -> Result<Vec<String>, TaskDedupError>;

    /// Trims active matches for `document_id`.
    async fn trim_matches(&self, document_id: &str, limit: i64) -> Result<(), TaskDedupError>;

    /// Lists active duplicate matches for `document_id`.
    async fn active_duplicates(
        &self,
        document_id: &str,
    ) -> Result<Vec<TaskDuplicate>, TaskDedupError>;

    /// Dismisses a match visible from `document_id`.
    async fn dismiss_match(
        &self,
        document_id: &str,
        match_id: Uuid,
        dismissed_by: &str,
    ) -> Result<bool, TaskDedupError>;

    /// Returns whether a match contains `document_id`.
    async fn match_contains(
        &self,
        document_id: &str,
        match_id: Uuid,
    ) -> Result<bool, TaskDedupError>;

    /// Returns the task document ids in a match.
    async fn match_document_ids(&self, match_id: Uuid) -> Result<Vec<String>, TaskDedupError>;

    /// Dismisses a match without document-side filtering.
    async fn dismiss_match_by_id(&self, match_id: Uuid) -> Result<(), TaskDedupError>;

    /// Returns the display name of each requested task document, keyed by
    /// document id. Missing or deleted documents are omitted.
    async fn task_names(
        &self,
        document_ids: &[String],
    ) -> Result<HashMap<String, String>, TaskDedupError>;
}

/// Sends live updates for documents whose duplicate state changed.
#[async_trait]
pub trait TaskDedupNotifier: Send + Sync {
    /// Notifies that duplicate matches changed for `document_id`.
    async fn notify_matches_updated(&self, document_id: &str) -> anyhow::Result<()>;
}
