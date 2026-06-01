//! Domain service for task duplicate detection.

#[cfg(test)]
mod test;

use std::collections::HashSet;
use std::sync::Arc;

use uuid::Uuid;

use super::models::{NewTask, TaskDedupError, TaskDuplicate, TaskSimilarityResult};
use super::ports::{
    TaskDedupNotifier, TaskDedupRepo, TaskDuplicateJudge, TaskEmbedder, TaskReranker,
};

/// Configuration for the task duplicate detection pipeline.
#[derive(Debug, Clone)]
pub struct TaskDedupConfig {
    /// Embedding model identifier persisted with embedding rows.
    pub embedding_model: String,
    /// Maximum vector candidates to retrieve.
    pub vector_candidate_limit: i64,
    /// Maximum active duplicate matches to keep per task.
    pub duplicate_limit: i64,
    /// Minimum vector similarity for a candidate to be considered.
    pub min_vector_similarity: f64,
    /// Maximum candidates sent to the LLM judge per new task, in vector-score
    /// order. Bounds judge calls now that the cheap lexical pre-filter is gone.
    pub max_judge_candidates: usize,
}

impl Default for TaskDedupConfig {
    fn default() -> Self {
        Self {
            embedding_model: "text-embedding-3-small".to_string(),
            vector_candidate_limit: 24,
            duplicate_limit: 5,
            min_vector_similarity: 0.74,
            max_judge_candidates: 10,
        }
    }
}

/// Task duplicate detection service.
#[derive(Clone)]
pub struct TaskDedupService {
    config: TaskDedupConfig,
    repo: Arc<dyn TaskDedupRepo>,
    embedder: Arc<dyn TaskEmbedder>,
    reranker: Arc<dyn TaskReranker>,
    judge: Arc<dyn TaskDuplicateJudge>,
    notifier: Arc<dyn TaskDedupNotifier>,
}

impl TaskDedupService {
    /// Creates a new service from its ports.
    pub fn new(
        config: TaskDedupConfig,
        repo: Arc<dyn TaskDedupRepo>,
        embedder: Arc<dyn TaskEmbedder>,
        reranker: Arc<dyn TaskReranker>,
        judge: Arc<dyn TaskDuplicateJudge>,
        notifier: Arc<dyn TaskDedupNotifier>,
    ) -> Self {
        Self {
            config,
            repo,
            embedder,
            reranker,
            judge,
            notifier,
        }
    }

    /// Lists active duplicate matches for a document.
    pub async fn active_duplicates(
        &self,
        document_id: &str,
    ) -> Result<Vec<TaskDuplicate>, TaskDedupError> {
        self.repo.active_duplicates(document_id).await
    }

    /// Dismisses visible matches.
    pub async fn dismiss_matches(
        &self,
        document_id: &str,
        match_ids: &[Uuid],
        dismissed_by: &str,
    ) -> Result<(), TaskDedupError> {
        let unique_match_ids = match_ids.iter().copied().collect::<HashSet<_>>();
        if unique_match_ids.is_empty() {
            return Ok(());
        }

        let mut affected_document_ids = HashSet::new();
        for match_id in &unique_match_ids {
            if !self.repo.match_contains(document_id, *match_id).await? {
                return Err(TaskDedupError::MatchNotFound);
            }
            affected_document_ids.extend(self.match_document_ids(*match_id).await?);
        }

        for match_id in unique_match_ids {
            let dismissed = self
                .repo
                .dismiss_match(document_id, match_id, dismissed_by)
                .await?;
            if !dismissed {
                return Err(TaskDedupError::MatchNotFound);
            }
        }

        self.notify_documents(affected_document_ids).await;
        Ok(())
    }

    /// Ensures a match contains the given document.
    pub async fn ensure_match_contains(
        &self,
        document_id: &str,
        match_id: Uuid,
    ) -> Result<(), TaskDedupError> {
        if self.repo.match_contains(document_id, match_id).await? {
            Ok(())
        } else {
            Err(TaskDedupError::MatchNotFound)
        }
    }

    /// Dismisses a match by id.
    pub async fn dismiss_match_by_id(&self, match_id: Uuid) -> Result<(), TaskDedupError> {
        let affected_document_ids = self.match_document_ids(match_id).await?;
        self.repo.dismiss_match_by_id(match_id).await?;
        self.notify_documents(affected_document_ids).await;
        Ok(())
    }

    /// Finds existing tasks similar to an unsaved draft as the user composes it.
    ///
    /// Runs vector retrieval + rerank only (no judge) and persists nothing: the
    /// embedding is computed in memory and discarded. Results are ordered by the
    /// reranker's relevance score.
    pub async fn similarity_search(
        &self,
        owner: &str,
        team_id: Option<Uuid>,
        title: &str,
        markdown: &str,
    ) -> Result<Vec<TaskSimilarityResult>, TaskDedupError> {
        let content = task_embedding_content(title, markdown);
        let embedding = self.embedder.embed(&content).await?;

        let candidates = self
            .repo
            .similarity_candidates(
                owner,
                team_id,
                &embedding,
                self.config.vector_candidate_limit,
            )
            .await?;

        let candidates = candidates
            .into_iter()
            .filter(|candidate| candidate.vector_score >= self.config.min_vector_similarity)
            .collect::<Vec<_>>();

        let ranked = self
            .rerank(&content, candidates, |candidate| candidate.content.as_str())
            .await?;

        Ok(ranked
            .into_iter()
            .take(self.config.duplicate_limit.max(0) as usize)
            .map(|candidate| TaskSimilarityResult {
                task_id: candidate.document_id,
                task_name: candidate.name,
                vector_score: candidate.vector_score,
            })
            .collect())
    }

    /// Detects duplicates for a newly-created task and sends live updates for
    /// documents that now have active matches.
    pub async fn detect_new_task(&self, task: NewTask) -> Result<Vec<String>, TaskDedupError> {
        let content = task_embedding_content(&task.title, &task.markdown);
        let embedding = self.embedder.embed(&content).await?;
        let mut changed_document_ids = HashSet::new();

        self.repo
            .upsert_embedding(
                &task.document_id,
                &self.config.embedding_model,
                &content,
                &embedding,
            )
            .await?;

        let candidates = self
            .repo
            .candidates(&task, &embedding, self.config.vector_candidate_limit)
            .await?;

        // Gate by the vector-similarity floor, rerank the survivors, then send
        // only the top `max_judge_candidates` (by rerank score) to the LLM judge.
        let candidates = candidates
            .into_iter()
            .filter(|candidate| candidate.vector_score >= self.config.min_vector_similarity)
            .collect::<Vec<_>>();
        let judge_candidates = self
            .rerank(&content, candidates, |candidate| candidate.content.as_str())
            .await?
            .into_iter()
            .take(self.config.max_judge_candidates);

        for candidate in judge_candidates {
            let judge = self.judge.judge(&content, &candidate.content).await;
            if !judge.is_duplicate {
                continue;
            }

            let (task_id, duplicate_task_id) =
                ordered_pair(&task.document_id, &candidate.document_id);
            let component = self
                .duplicate_component([task_id.to_string(), duplicate_task_id.to_string()])
                .await?;
            let reason = inferred_judge_reason(judge.reason.as_deref());
            for (left, right) in complete_graph_pairs(&component) {
                self.repo
                    .upsert_match(
                        left,
                        right,
                        candidate.vector_score,
                        judge.model.as_deref(),
                        Some(&reason),
                    )
                    .await?;

                changed_document_ids.insert(left.to_string());
                changed_document_ids.insert(right.to_string());
            }
        }

        for changed_document_id in &changed_document_ids {
            self.repo
                .trim_matches(changed_document_id, self.config.duplicate_limit)
                .await?;
        }

        let mut active_document_ids = Vec::new();
        for changed_document_id in changed_document_ids {
            if !self
                .repo
                .active_duplicates(&changed_document_id)
                .await?
                .is_empty()
            {
                active_document_ids.push(changed_document_id);
            }
        }

        self.notify_documents(active_document_ids.clone()).await;
        Ok(active_document_ids)
    }

    /// Reranks `candidates` against `query` and returns them ordered by
    /// descending relevance score. Candidates with equal scores keep their input
    /// (vector-similarity) order. An empty input skips the reranker entirely.
    async fn rerank<C: Send>(
        &self,
        query: &str,
        candidates: Vec<C>,
        content_of: impl Fn(&C) -> &str,
    ) -> Result<Vec<C>, TaskDedupError> {
        if candidates.is_empty() {
            return Ok(candidates);
        }

        let documents = candidates
            .iter()
            .map(|candidate| content_of(candidate).to_string())
            .collect::<Vec<_>>();
        let scores = self.reranker.rerank(query, &documents).await?;
        if scores.len() != candidates.len() {
            return Err(TaskDedupError::Dependency(anyhow::anyhow!(
                "reranker returned {} scores for {} documents",
                scores.len(),
                candidates.len()
            )));
        }

        let mut scored = candidates.into_iter().zip(scores).collect::<Vec<_>>();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        Ok(scored
            .into_iter()
            .map(|(candidate, _score)| candidate)
            .collect())
    }

    async fn notify_documents<I>(&self, document_ids: I)
    where
        I: IntoIterator<Item = String>,
    {
        for document_id in document_ids {
            if let Err(error) = self.notifier.notify_matches_updated(&document_id).await {
                tracing::error!(
                    error=?error,
                    document_id,
                    "failed to send task duplicate live update"
                );
            }
        }
    }

    async fn match_document_ids(&self, match_id: Uuid) -> Result<Vec<String>, TaskDedupError> {
        let document_ids = self.repo.match_document_ids(match_id).await?;
        if document_ids.is_empty() {
            Err(TaskDedupError::MatchNotFound)
        } else {
            Ok(document_ids)
        }
    }

    async fn duplicate_component<I>(&self, document_ids: I) -> Result<Vec<String>, TaskDedupError>
    where
        I: IntoIterator<Item = String>,
    {
        let seeds = document_ids.into_iter().collect::<HashSet<_>>();
        let seed_list = seeds.iter().cloned().collect::<Vec<_>>();
        let mut component = self
            .repo
            .active_duplicate_component(&seed_list)
            .await?
            .into_iter()
            .collect::<HashSet<_>>();
        component.extend(seeds);

        let mut component = component.into_iter().collect::<Vec<_>>();
        component.sort();
        Ok(component)
    }
}

/// Builds the text embedded for a task.
pub fn task_embedding_content(title: &str, markdown: &str) -> String {
    format!("{}\n{}", title.trim(), markdown.trim())
}

/// Returns a stable ordered pair.
pub fn ordered_pair<'a>(a: &'a str, b: &'a str) -> (&'a str, &'a str) {
    if a < b { (a, b) } else { (b, a) }
}

fn complete_graph_pairs(document_ids: &[String]) -> Vec<(&str, &str)> {
    let mut pairs = Vec::new();
    for (index, left) in document_ids.iter().enumerate() {
        for right in document_ids.iter().skip(index + 1) {
            pairs.push(ordered_pair(left.as_str(), right.as_str()));
        }
    }
    pairs
}

fn inferred_judge_reason(reason: Option<&str>) -> String {
    match reason {
        Some(reason) if !reason.trim().is_empty() => {
            format!("duplicate graph closure: {}", reason.trim())
        }
        _ => "duplicate graph closure".to_string(),
    }
}
