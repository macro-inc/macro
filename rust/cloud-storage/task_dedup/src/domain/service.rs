//! Domain service for task duplicate detection.

#[cfg(test)]
mod test;

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use embedding::entity::Task;
use embedding::{Content, EmbeddingModel, KeyedEmbedding, RerankModel, SearchResults, VectorStore};
use uuid::Uuid;

use super::models::{
    NewTask, TaskDedupError, TaskDuplicate, TaskSearchParameters, TaskSimilarityResult,
};
use super::ports::{TaskDedupNotifier, TaskDuplicateJudge, TaskMatchRepo};

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

/// A candidate task surfaced by vector retrieval, collapsed from the per-field
/// [`SearchResults`] into a single score and a reconstructed text used for
/// reranking and judging.
struct Candidate {
    document_id: String,
    /// The candidate's stored field contents joined back together.
    content: String,
    /// Best cosine similarity across the query × stored field cross-product.
    vector_score: f64,
}

/// Task duplicate detection service.
///
/// Embedding (`E`), vector storage (`V`), and reranking (`R`) are supplied by the
/// [`embedding`] crate's traits. They are generic rather than `dyn` because those
/// traits use return-position `impl Trait` / associated types and are not
/// object-safe. The judge, notifier, and match repo remain `dyn` ports.
#[derive(Clone)]
pub struct TaskDedupService<const DIMS: usize, E, V, R> {
    config: TaskDedupConfig,
    embedder: E,
    vector_db: V,
    reranker: R,
    judge: Arc<dyn TaskDuplicateJudge>,
    notifier: Arc<dyn TaskDedupNotifier>,
    matches: Arc<dyn TaskMatchRepo>,
}

impl<const DIMS: usize, E, V, R> TaskDedupService<DIMS, E, V, R>
where
    E: EmbeddingModel<DIMS> + Send + Sync,
    V: VectorStore<DIMS, Metadata = String, SearchParameters = TaskSearchParameters> + Send + Sync,
    V::Error: Into<anyhow::Error>,
    R: RerankModel<DIMS> + Send + Sync,
{
    /// Creates a new service from its dependencies.
    pub fn new(
        config: TaskDedupConfig,
        embedder: E,
        vector_db: V,
        reranker: R,
        judge: Arc<dyn TaskDuplicateJudge>,
        notifier: Arc<dyn TaskDedupNotifier>,
        matches: Arc<dyn TaskMatchRepo>,
    ) -> Self {
        Self {
            config,
            embedder,
            vector_db,
            reranker,
            judge,
            notifier,
            matches,
        }
    }

    /// Lists active duplicate matches for a document.
    pub async fn active_duplicates(
        &self,
        document_id: &str,
    ) -> Result<Vec<TaskDuplicate>, TaskDedupError> {
        self.matches.active_duplicates(document_id).await
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
            if !self.matches.match_contains(document_id, *match_id).await? {
                return Err(TaskDedupError::MatchNotFound);
            }
            affected_document_ids.extend(self.match_document_ids(*match_id).await?);
        }

        for match_id in unique_match_ids {
            let dismissed = self
                .matches
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
        if self.matches.match_contains(document_id, match_id).await? {
            Ok(())
        } else {
            Err(TaskDedupError::MatchNotFound)
        }
    }

    /// Dismisses a match by id.
    pub async fn dismiss_match_by_id(&self, match_id: Uuid) -> Result<(), TaskDedupError> {
        let affected_document_ids = self.match_document_ids(match_id).await?;
        self.matches.dismiss_match_by_id(match_id).await?;
        self.notify_documents(affected_document_ids).await;
        Ok(())
    }

    /// Finds existing tasks similar to an unsaved draft as the user composes it.
    ///
    /// Runs vector retrieval + rerank only (no judge) and persists nothing: the
    /// embedding is computed in memory and discarded. Results are ordered by the
    /// reranker's relevance score. `markdown` is embedded as-is and should be
    /// embedding-format markdown, matching how stored tasks are embedded.
    pub async fn similarity_search(
        &self,
        owner: &str,
        team_id: Option<Uuid>,
        title: &str,
        markdown: &str,
    ) -> Result<Vec<TaskSimilarityResult>, TaskDedupError> {
        let embeddable = Task {
            title: Cow::Borrowed(title),
            body: Cow::Borrowed(markdown),
        };
        let labeled = self.embedder.embed(&embeddable).await?;
        if labeled.is_empty() {
            return Ok(Vec::new());
        }
        let query: Vec<KeyedEmbedding<DIMS>> = labeled
            .iter()
            .map(|field| KeyedEmbedding {
                search_key: field.search_key,
                embedding: field.embedding,
            })
            .collect();

        let params = TaskSearchParameters {
            owner: owner.to_string(),
            team_id,
            limit: self.config.vector_candidate_limit,
            exclude_document_id: None,
            exclude_dismissed: false,
        };
        let results = self
            .vector_db
            .cosine_search(query, params)
            .await
            .map_err(|error| TaskDedupError::Dependency(error.into()))?;

        let query_content = full_text(title, markdown);
        let ranked = self
            .rerank(&query_content, results)
            .await?
            .into_iter()
            .take(self.config.duplicate_limit.max(0) as usize)
            .collect::<Vec<_>>();

        let document_ids = ranked
            .iter()
            .map(|candidate| candidate.document_id.clone())
            .collect::<Vec<_>>();
        let names = self.matches.task_names(&document_ids).await?;

        Ok(ranked
            .into_iter()
            .map(|candidate| TaskSimilarityResult {
                task_name: names
                    .get(&candidate.document_id)
                    .cloned()
                    .unwrap_or_default(),
                task_id: candidate.document_id,
                vector_score: candidate.vector_score,
            })
            .collect())
    }

    /// Detects duplicates for a newly-created task and sends live updates for
    /// documents that now have active matches.
    pub async fn detect_new_task(&self, task: NewTask) -> Result<Vec<String>, TaskDedupError> {
        let embeddable = task.as_embeddable();
        let labeled = self.embedder.embed(&embeddable).await?;
        if labeled.is_empty() {
            return Ok(Vec::new());
        }
        let mut changed_document_ids = HashSet::new();

        // Build the query before moving the labeled embeddings into the store;
        // the vectors are `Copy` so this borrows rather than clones the content.
        let query: Vec<KeyedEmbedding<DIMS>> = labeled
            .iter()
            .map(|field| KeyedEmbedding {
                search_key: field.search_key,
                embedding: field.embedding,
            })
            .collect();

        self.vector_db
            .upsert_embeddings(task.document_id.clone(), labeled)
            .await
            .map_err(|error| TaskDedupError::Dependency(error.into()))?;

        let params = TaskSearchParameters {
            owner: task.owner.clone(),
            team_id: task.team_id,
            limit: self.config.vector_candidate_limit,
            exclude_document_id: Some(task.document_id.clone()),
            exclude_dismissed: true,
        };
        let results = self
            .vector_db
            .cosine_search(query, params)
            .await
            .map_err(|error| TaskDedupError::Dependency(error.into()))?;

        // Gate by the vector-similarity floor, rerank the survivors, then send
        // only the top `max_judge_candidates` (by rerank score) to the LLM judge.
        let query_content = full_text(&task.title, &task.markdown);
        let judge_candidates = self
            .rerank(&query_content, results)
            .await?
            .into_iter()
            .take(self.config.max_judge_candidates);

        for candidate in judge_candidates {
            let judge = self.judge.judge(&query_content, &candidate.content).await;
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
                self.matches
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
            self.matches
                .trim_matches(changed_document_id, self.config.duplicate_limit)
                .await?;
        }

        let mut active_document_ids = Vec::new();
        for changed_document_id in changed_document_ids {
            if !self
                .matches
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

    /// Collapses a single entity's per-field [`SearchResults`] into a
    /// [`Candidate`]: the vector score is the best similarity across the query ×
    /// stored-field cross-product, and the content is the entity's matched field
    /// texts joined back together for judging. Returns `None` when the entity
    /// falls below the configured similarity floor.
    fn collapse(&self, result: &SearchResults<String, DIMS>) -> Option<Candidate> {
        let vector_score = result
            .matches
            .iter()
            .map(|matched| matched.score as f64)
            .fold(f64::NEG_INFINITY, f64::max);
        if !vector_score.is_finite() || vector_score < self.config.min_vector_similarity {
            return None;
        }
        let content = result
            .matches
            .iter()
            .map(|matched| matched.embedding.content.as_ref())
            .collect::<Vec<_>>()
            .join("\n");
        Some(Candidate {
            document_id: result.metadata.clone(),
            content,
            vector_score,
        })
    }

    /// Drops results below the similarity floor, reranks the survivors against
    /// `query`, and returns them as [`Candidate`]s ordered by descending
    /// relevance. The reranker only carries each result's `document_id` through,
    /// so the collapsed content and vector score are looked back up afterwards.
    /// An empty survivor set skips the reranker entirely.
    async fn rerank(
        &self,
        query: &str,
        results: Vec<SearchResults<String, DIMS>>,
    ) -> Result<Vec<Candidate>, TaskDedupError> {
        let mut lookup: HashMap<String, Candidate> = HashMap::new();
        let mut survivors: Vec<SearchResults<String, DIMS>> = Vec::new();
        for result in results {
            let Some(candidate) = self.collapse(&result) else {
                continue;
            };
            lookup.insert(candidate.document_id.clone(), candidate);
            survivors.push(result);
        }

        if survivors.is_empty() {
            return Ok(Vec::new());
        }

        let reranked = self
            .reranker
            .rerank(Content::Borrowed(query), survivors)
            .await
            .map_err(TaskDedupError::Dependency)?;

        Ok(reranked
            .into_iter()
            .filter_map(|scored| lookup.remove(&scored.item))
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
        let document_ids = self.matches.match_document_ids(match_id).await?;
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
            .matches
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

/// Builds the full task text used as the rerank/judge query, joining the title
/// and body the same way they read to a user.
fn full_text(title: &str, markdown: &str) -> String {
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
