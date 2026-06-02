//! Domain models for task duplicate detection.

use std::borrow::Cow;

use embedding::entity::Task;
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

impl NewTask {
    /// Borrows this task as an [`Embeddable`](embedding::Embeddable) entity so its
    /// title and body are embedded as separate fields.
    pub fn as_embeddable(&self) -> Task<'_> {
        Task {
            title: Cow::Borrowed(self.title.as_str()),
            body: Cow::Borrowed(self.markdown.as_str()),
        }
    }
}

/// Filters applied to a task vector search.
///
/// This is the [`VectorDb::SearchParameters`](embedding::VectorDb::SearchParameters)
/// for the task duplicate store: it scopes a cosine search to the tasks a user is
/// allowed to see and optionally excludes the query task itself and any pairs the
/// user has already dismissed.
#[derive(Debug, Clone)]
pub struct TaskSearchParameters {
    /// Owner whose tasks are in scope.
    pub owner: String,
    /// Team whose shared tasks are also in scope, when set.
    pub team_id: Option<Uuid>,
    /// Maximum number of candidate tasks to return.
    pub limit: i64,
    /// Document id to exclude from results (the query task itself), when set.
    pub exclude_document_id: Option<String>,
    /// When true, drop candidates already dismissed against
    /// [`exclude_document_id`](Self::exclude_document_id).
    pub exclude_dismissed: bool,
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
    /// LLM judge explanation when available.
    pub judge_reason: Option<String>,
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
