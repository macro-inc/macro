//! Domain models for task duplicate detection.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A newly-created task to index and compare.
#[derive(Debug, Clone)]
pub struct NewTask {
    /// Document id of the created task.
    pub document_id: String,
    /// Owner user id.
    pub owner: String,
    /// Team id when the task is shared with a team.
    pub team_id: Option<Uuid>,
    /// Task title.
    pub title: String,
    /// Task markdown body.
    pub markdown: String,
}

/// A duplicate task candidate shown on the task surface.
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskDuplicate {
    /// Match row id.
    pub id: Uuid,
    /// The other task in the duplicate pair.
    pub task_id: String,
    /// The other task's display name.
    pub task_name: String,
    /// Cosine similarity from vector search.
    pub vector_score: f64,
    /// Deterministic rerank score.
    pub rerank_score: f64,
    /// LLM judge explanation when available.
    pub judge_reason: Option<String>,
}

/// Candidate returned by the retrieval layer before deterministic rerank and
/// judging.
#[derive(Debug, Clone)]
pub struct TaskDuplicateCandidate {
    /// Candidate task document id.
    pub document_id: String,
    /// Candidate embedding content.
    pub content: String,
    /// Candidate vector similarity.
    pub vector_score: f64,
}

/// A similar existing task computed for an unsaved draft, returned to the task
/// composer without persisting any embedding or match state.
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskSimilarityResult {
    /// The matching existing task.
    pub task_id: String,
    /// The matching task's display name.
    pub task_name: String,
    /// Cosine similarity from vector search.
    pub vector_score: f64,
    /// Deterministic rerank score.
    pub rerank_score: f64,
}

/// Candidate returned by the similarity-search retrieval layer, carrying the
/// task display name so the composer can render a match without a match row.
#[derive(Debug, Clone)]
pub struct TaskSimilarityCandidate {
    /// Candidate task document id.
    pub document_id: String,
    /// Candidate task display name.
    pub name: String,
    /// Candidate embedding content.
    pub content: String,
    /// Candidate vector similarity.
    pub vector_score: f64,
}

/// Output from a duplicate judge.
#[derive(Debug, Clone)]
pub struct JudgeResult {
    /// Whether the two task descriptions are duplicates.
    pub is_duplicate: bool,
    /// Judge model name, when a remote model was used.
    pub model: Option<String>,
    /// Optional judge explanation.
    pub reason: Option<String>,
}

/// Errors produced by task duplicate detection.
#[derive(Debug, thiserror::Error)]
pub enum TaskDedupError {
    /// A referenced duplicate match was not found.
    #[error("duplicate match not found")]
    MatchNotFound,
    /// Persistence failed.
    #[error(transparent)]
    Storage(#[from] sqlx::Error),
    /// Pipeline dependency failed.
    #[error(transparent)]
    Dependency(#[from] anyhow::Error),
}
