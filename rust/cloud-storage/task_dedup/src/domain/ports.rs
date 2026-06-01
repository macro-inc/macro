//! Ports for the task duplicate detection pipeline.

use async_trait::async_trait;
use uuid::Uuid;

use super::models::{
    JudgeResult, NewTask, TaskDedupError, TaskDuplicate, TaskDuplicateCandidate,
    TaskSimilarityCandidate,
};

/// Embeds task text into a vector representation.
#[async_trait]
pub trait TaskEmbedder: Send + Sync {
    /// Embeds `content`.
    async fn embed(&self, content: &str) -> anyhow::Result<Vec<f32>>;
}

/// Applies a semantic duplicate judgement after retrieval and deterministic
/// reranking.
#[async_trait]
pub trait TaskDuplicateJudge: Send + Sync {
    /// Judges whether `left` and `right` represent the same task.
    async fn judge(&self, left: &str, right: &str, rerank_score: f64) -> JudgeResult;
}

/// Persists embeddings, retrieves candidates, and manages match state.
#[async_trait]
pub trait TaskDedupRepo: Send + Sync {
    /// Upserts the current task embedding.
    async fn upsert_embedding(
        &self,
        document_id: &str,
        model: &str,
        content: &str,
        embedding: &[f32],
    ) -> Result<(), TaskDedupError>;

    /// Retrieves vector candidates for a task.
    async fn candidates(
        &self,
        task: &NewTask,
        embedding: &[f32],
        limit: i64,
    ) -> Result<Vec<TaskDuplicateCandidate>, TaskDedupError>;

    /// Retrieves vector candidates for an unsaved task scoped to `owner` and an
    /// optional `team_id`, without any self- or dismissed-match exclusion.
    async fn similarity_candidates(
        &self,
        owner: &str,
        team_id: Option<Uuid>,
        embedding: &[f32],
        limit: i64,
    ) -> Result<Vec<TaskSimilarityCandidate>, TaskDedupError>;

    /// Upserts an active duplicate match.
    async fn upsert_match(
        &self,
        task_id: &str,
        duplicate_task_id: &str,
        vector_score: f64,
        rerank_score: f64,
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

    /// Returns the other task id in a match.
    async fn other_task_id(
        &self,
        document_id: &str,
        match_id: Uuid,
    ) -> Result<Option<String>, TaskDedupError>;

    /// Returns the task document ids in a match.
    async fn match_document_ids(&self, match_id: Uuid) -> Result<Vec<String>, TaskDedupError>;

    /// Dismisses a match without document-side filtering.
    async fn dismiss_match_by_id(&self, match_id: Uuid) -> Result<(), TaskDedupError>;

    /// Marks a match dismissed by a user.
    async fn dismiss_match_by_id_for_user(
        &self,
        match_id: Uuid,
        dismissed_by: &str,
    ) -> Result<(), TaskDedupError>;
}

/// Sends live updates for documents whose duplicate state changed.
#[async_trait]
pub trait TaskDedupNotifier: Send + Sync {
    /// Notifies that duplicate matches changed for `document_id`.
    async fn notify_matches_updated(&self, document_id: &str) -> anyhow::Result<()>;
}
