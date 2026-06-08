//! Service-level pipeline tests against in-memory mock dependencies.
//!
//! These exercise [`TaskDedupService`] end to end without a database: the
//! embedder, vector store, reranker, judge, notifier, and match repo are all
//! mocked here so each stage of the retrieve → rerank → judge → persist → notify
//! pipeline can be asserted in isolation.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use embedding::{
    Content, Embeddable, EmbeddingModel, KeyedEmbedding, LabeledEmbedding, Match, RerankModel,
    Reranked, SearchResults, VectorStore,
};
use uuid::Uuid;

use super::{TaskDedupConfig, TaskDedupService};
use crate::domain::models::{
    JudgeResult, NewTask, TaskDedupError, TaskDuplicate, TaskSearchParameters,
};
use crate::domain::ports::{TaskDedupNotifier, TaskDuplicateJudge, TaskMatchRepo};

/// Small embedding width so mock vectors stay tiny.
const DIMS: usize = 4;

type MockService = TaskDedupService<DIMS, MockEmbedder, MockVectorDb, MockReranker>;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/// Embedder that emits a zero vector per field exposed by the content.
struct MockEmbedder;

impl EmbeddingModel<DIMS> for MockEmbedder {
    async fn embed(
        &self,
        content: &(dyn Embeddable + Sync),
    ) -> anyhow::Result<Vec<LabeledEmbedding<'static, DIMS>>> {
        Ok(content
            .embedding_content()
            .into_iter()
            .map(|(search_key, text)| LabeledEmbedding {
                search_key,
                content: Content::Owned(text.into_owned()),
                embedding: [0.0; DIMS],
            })
            .collect())
    }
}

/// Vector store returning preset `(document_id, content, score)` candidates, each
/// as a single-field [`SearchResults`]. Records upserts and the last search
/// parameters so the detect/similarity paths can be asserted.
#[derive(Clone, Default)]
struct MockVectorDb {
    inner: Arc<MockVectorDbInner>,
}

#[derive(Default)]
struct MockVectorDbInner {
    results: Vec<(String, String, f32)>,
    upserted: Mutex<Vec<String>>,
    last_params: Mutex<Option<TaskSearchParameters>>,
}

impl MockVectorDb {
    fn with_results(results: Vec<(&str, &str, f32)>) -> Self {
        Self {
            inner: Arc::new(MockVectorDbInner {
                results: results
                    .into_iter()
                    .map(|(id, content, score)| (id.to_string(), content.to_string(), score))
                    .collect(),
                ..Default::default()
            }),
        }
    }
}

impl VectorStore<DIMS> for MockVectorDb {
    type Error = anyhow::Error;
    type Metadata = String;
    type SearchParameters = TaskSearchParameters;

    async fn upsert_embeddings<'a>(
        &self,
        metadata: String,
        _embeddings: Vec<LabeledEmbedding<'a, DIMS>>,
    ) -> anyhow::Result<()> {
        self.inner.upserted.lock().unwrap().push(metadata);
        Ok(())
    }

    async fn cosine_search(
        &self,
        _query: Vec<KeyedEmbedding<DIMS>>,
        params: TaskSearchParameters,
    ) -> anyhow::Result<Vec<SearchResults<String, DIMS>>> {
        *self.inner.last_params.lock().unwrap() = Some(params);
        Ok(self
            .inner
            .results
            .iter()
            .map(|(id, content, score)| SearchResults {
                metadata: id.clone(),
                matches: vec![Match {
                    score: *score,
                    embedding: LabeledEmbedding {
                        search_key: "title",
                        content: Content::Owned(content.clone()),
                        embedding: [0.0; DIMS],
                    },
                }],
            })
            .collect())
    }
}

/// Reranker that scores candidates from a content→score map (default 0.0),
/// returning them sorted by descending score (stable for ties) and recording
/// every call so tests can assert it ran on each path.
#[derive(Clone, Default)]
struct MockReranker {
    inner: Arc<MockRerankerInner>,
}

#[derive(Default)]
struct MockRerankerInner {
    scores: HashMap<String, f64>,
    calls: Mutex<Vec<(String, Vec<String>)>>,
}

impl MockReranker {
    fn new(scores: &[(&str, f64)]) -> Self {
        Self {
            inner: Arc::new(MockRerankerInner {
                scores: scores.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
                calls: Mutex::default(),
            }),
        }
    }

    fn calls(&self) -> Vec<(String, Vec<String>)> {
        self.inner.calls.lock().unwrap().clone()
    }
}

impl<const DIMS: usize> RerankModel<DIMS> for MockReranker {
    async fn rerank<'a, T: Send>(
        &self,
        query: Content<'a>,
        candidates: Vec<SearchResults<T, DIMS>>,
    ) -> anyhow::Result<Vec<Reranked<T>>> {
        // Reconstruct each candidate's content the same way the service does so
        // the content→score map keys still line up.
        let documents = candidates
            .iter()
            .map(|result| {
                result
                    .matches
                    .iter()
                    .map(|matched| matched.embedding.content.as_ref())
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .collect::<Vec<_>>();
        self.inner
            .calls
            .lock()
            .unwrap()
            .push((query.into_owned(), documents.clone()));

        let mut scored = candidates
            .into_iter()
            .zip(documents)
            .map(|(result, content)| {
                let score = self.inner.scores.get(&content).copied().unwrap_or(0.0) as f32;
                Reranked {
                    item: result.metadata,
                    score,
                }
            })
            .collect::<Vec<_>>();
        scored.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(scored)
    }
}

/// Judge that calls a content a duplicate iff its right-hand text is in the
/// configured set, recording every (left, right) it sees.
#[derive(Default)]
struct MockJudge {
    duplicates: HashSet<String>,
    calls: Mutex<Vec<(String, String)>>,
}

#[async_trait]
impl TaskDuplicateJudge for MockJudge {
    async fn judge(&self, left: &str, right: &str) -> JudgeResult {
        self.calls
            .lock()
            .unwrap()
            .push((left.to_string(), right.to_string()));
        JudgeResult {
            is_duplicate: self.duplicates.contains(right),
            model: Some("mock-judge".to_string()),
            reason: Some("mock reason".to_string()),
        }
    }
}

#[derive(Default)]
struct MockNotifier {
    notified: Mutex<Vec<String>>,
}

#[async_trait]
impl TaskDedupNotifier for MockNotifier {
    async fn notify_matches_updated(&self, document_id: &str) -> anyhow::Result<()> {
        self.notified.lock().unwrap().push(document_id.to_string());
        Ok(())
    }
}

struct MatchRow {
    id: Uuid,
    task_id: String,
    duplicate_task_id: String,
    status: String,
    vector_score: f64,
    judge_reason: Option<String>,
}

struct RecordedMatch {
    task_id: String,
    duplicate_task_id: String,
    judge_model: Option<String>,
}

/// In-memory match repo: a live match store recording the writes (matches,
/// trims) the service performs.
#[derive(Default)]
struct MockMatchRepo {
    /// Extra documents `active_duplicate_component` folds in beyond the seeds,
    /// to exercise duplicate-graph closure.
    component_extra: Vec<String>,
    matches: Mutex<Vec<MatchRow>>,
    upserted_matches: Mutex<Vec<RecordedMatch>>,
    trimmed: Mutex<Vec<(String, i64)>>,
}

impl MockMatchRepo {
    fn add_active_match(&self, task_id: &str, duplicate_task_id: &str) -> Uuid {
        let id = Uuid::new_v4();
        self.matches.lock().unwrap().push(MatchRow {
            id,
            task_id: task_id.to_string(),
            duplicate_task_id: duplicate_task_id.to_string(),
            status: "active".to_string(),
            vector_score: 0.9,
            judge_reason: Some("seed".to_string()),
        });
        id
    }
}

#[async_trait]
impl TaskMatchRepo for MockMatchRepo {
    async fn upsert_match(
        &self,
        task_id: &str,
        duplicate_task_id: &str,
        vector_score: f64,
        judge_model: Option<&str>,
        judge_reason: Option<&str>,
    ) -> Result<(), TaskDedupError> {
        self.upserted_matches.lock().unwrap().push(RecordedMatch {
            task_id: task_id.to_string(),
            duplicate_task_id: duplicate_task_id.to_string(),
            judge_model: judge_model.map(str::to_string),
        });

        let mut matches = self.matches.lock().unwrap();
        let exists = matches
            .iter()
            .any(|m| m.task_id == task_id && m.duplicate_task_id == duplicate_task_id);
        if !exists {
            matches.push(MatchRow {
                id: Uuid::new_v4(),
                task_id: task_id.to_string(),
                duplicate_task_id: duplicate_task_id.to_string(),
                status: "active".to_string(),
                vector_score,
                judge_reason: judge_reason.map(str::to_string),
            });
        }
        Ok(())
    }

    async fn active_duplicate_component(
        &self,
        document_ids: &[String],
    ) -> Result<Vec<String>, TaskDedupError> {
        let mut component: HashSet<String> = document_ids.iter().cloned().collect();
        component.extend(self.component_extra.iter().cloned());
        Ok(component.into_iter().collect())
    }

    async fn trim_matches(&self, document_id: &str, limit: i64) -> Result<(), TaskDedupError> {
        self.trimmed
            .lock()
            .unwrap()
            .push((document_id.to_string(), limit));
        Ok(())
    }

    async fn active_duplicates(
        &self,
        document_id: &str,
    ) -> Result<Vec<TaskDuplicate>, TaskDedupError> {
        let matches = self.matches.lock().unwrap();
        Ok(matches
            .iter()
            .filter(|m| {
                m.status == "active"
                    && (m.task_id == document_id || m.duplicate_task_id == document_id)
            })
            .map(|m| {
                let other = if m.task_id == document_id {
                    &m.duplicate_task_id
                } else {
                    &m.task_id
                };
                TaskDuplicate {
                    id: m.id,
                    task_id: other.clone(),
                    task_name: other.clone(),
                    vector_score: m.vector_score,
                    judge_reason: m.judge_reason.clone(),
                }
            })
            .collect())
    }

    async fn dismiss_match(
        &self,
        document_id: &str,
        match_id: Uuid,
        _dismissed_by: &str,
    ) -> Result<bool, TaskDedupError> {
        let mut matches = self.matches.lock().unwrap();
        for m in matches.iter_mut() {
            if m.id == match_id && (m.task_id == document_id || m.duplicate_task_id == document_id)
            {
                m.status = "dismissed".to_string();
                return Ok(true);
            }
        }
        Ok(false)
    }

    async fn match_contains(
        &self,
        document_id: &str,
        match_id: Uuid,
    ) -> Result<bool, TaskDedupError> {
        let matches = self.matches.lock().unwrap();
        Ok(matches.iter().any(|m| {
            m.id == match_id && (m.task_id == document_id || m.duplicate_task_id == document_id)
        }))
    }

    async fn match_document_ids(&self, match_id: Uuid) -> Result<Vec<String>, TaskDedupError> {
        let matches = self.matches.lock().unwrap();
        Ok(matches
            .iter()
            .find(|m| m.id == match_id)
            .map(|m| vec![m.task_id.clone(), m.duplicate_task_id.clone()])
            .unwrap_or_default())
    }

    async fn dismiss_match_by_id(&self, match_id: Uuid) -> Result<(), TaskDedupError> {
        let mut matches = self.matches.lock().unwrap();
        for m in matches.iter_mut() {
            if m.id == match_id {
                m.status = "dismissed".to_string();
            }
        }
        Ok(())
    }

    async fn task_names(
        &self,
        document_ids: &[String],
    ) -> Result<HashMap<String, String>, TaskDedupError> {
        Ok(document_ids
            .iter()
            .map(|id| (id.clone(), format!("{id} name")))
            .collect())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn new_task(document_id: &str) -> NewTask {
    NewTask {
        document_id: document_id.to_string(),
        owner: "owner".to_string(),
        team_id: None,
        title: "Query title".to_string(),
        markdown: "query body".to_string(),
    }
}

/// Builds a service, returning it alongside the mocks the test asserts on.
struct Harness {
    service: MockService,
    vector_db: MockVectorDb,
    reranker: MockReranker,
    judge: Arc<MockJudge>,
    notifier: Arc<MockNotifier>,
    matches: Arc<MockMatchRepo>,
}

fn build(
    config: TaskDedupConfig,
    vector_db: MockVectorDb,
    reranker: MockReranker,
    judge: Arc<MockJudge>,
    notifier: Arc<MockNotifier>,
    matches: Arc<MockMatchRepo>,
) -> Harness {
    let service = TaskDedupService::new(
        config,
        MockEmbedder,
        vector_db.clone(),
        reranker.clone(),
        judge.clone(),
        notifier.clone(),
        matches.clone(),
    );
    Harness {
        service,
        vector_db,
        reranker,
        judge,
        notifier,
        matches,
    }
}

fn judge(duplicates: &[&str]) -> Arc<MockJudge> {
    Arc::new(MockJudge {
        duplicates: duplicates.iter().map(|s| s.to_string()).collect(),
        calls: Mutex::default(),
    })
}

fn judged_right_sides(judge: &MockJudge) -> Vec<String> {
    judge
        .calls
        .lock()
        .unwrap()
        .iter()
        .map(|(_, right)| right.clone())
        .collect()
}

// ---------------------------------------------------------------------------
// detect_new_task
// ---------------------------------------------------------------------------

#[tokio::test]
async fn detect_creates_match_reranks_and_notifies() {
    let h = build(
        TaskDedupConfig::default(),
        MockVectorDb::with_results(vec![("A", "cand-a", 0.9)]),
        MockReranker::new(&[]),
        judge(&["cand-a"]),
        Arc::new(MockNotifier::default()),
        Arc::new(MockMatchRepo::default()),
    );

    let mut active = h.service.detect_new_task(new_task("NEW")).await.unwrap();
    active.sort();

    // Embedding persisted for the new task.
    assert_eq!(
        *h.vector_db.inner.upserted.lock().unwrap(),
        vec!["NEW".to_string()]
    );

    // The detect path scopes and excludes the query task and dismissed pairs.
    let params = h
        .vector_db
        .inner
        .last_params
        .lock()
        .unwrap()
        .clone()
        .unwrap();
    assert_eq!(params.exclude_document_id.as_deref(), Some("NEW"));
    assert!(params.exclude_dismissed);

    // A single ordered match was written, tagged with the judge's model.
    let upserts = h.matches.upserted_matches.lock().unwrap();
    assert_eq!(upserts.len(), 1);
    assert_eq!(upserts[0].task_id, "A");
    assert_eq!(upserts[0].duplicate_task_id, "NEW");
    assert_eq!(upserts[0].judge_model.as_deref(), Some("mock-judge"));
    drop(upserts);

    // The reranker ran in the judge path.
    assert_eq!(h.reranker.calls().len(), 1);

    // Both sides were trimmed and notified, and returned as active.
    assert_eq!(active, vec!["A".to_string(), "NEW".to_string()]);
    let mut notified = h.notifier.notified.lock().unwrap().clone();
    notified.sort();
    assert_eq!(notified, vec!["A".to_string(), "NEW".to_string()]);
    let trimmed: HashSet<String> = h
        .matches
        .trimmed
        .lock()
        .unwrap()
        .iter()
        .map(|(doc, _)| doc.clone())
        .collect();
    assert_eq!(trimmed, HashSet::from(["A".to_string(), "NEW".to_string()]));
}

#[tokio::test]
async fn detect_skips_candidates_below_vector_similarity() {
    let h = build(
        TaskDedupConfig::default(),
        MockVectorDb::with_results(vec![("A", "cand-a", 0.9), ("B", "cand-b", 0.5)]),
        MockReranker::new(&[]),
        judge(&["cand-a", "cand-b"]),
        Arc::new(MockNotifier::default()),
        Arc::new(MockMatchRepo::default()),
    );

    h.service.detect_new_task(new_task("NEW")).await.unwrap();

    // B (0.5 < 0.74) never reaches the reranker or the judge.
    let calls = h.reranker.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].1, vec!["cand-a".to_string()]);
    assert_eq!(judged_right_sides(&h.judge), vec!["cand-a".to_string()]);
}

#[tokio::test]
async fn detect_caps_judge_calls_at_max_candidates() {
    let config = TaskDedupConfig {
        max_judge_candidates: 2,
        ..Default::default()
    };
    let h = build(
        config,
        MockVectorDb::with_results(vec![
            ("A", "cand-a", 0.90),
            ("B", "cand-b", 0.85),
            ("C", "cand-c", 0.80),
        ]),
        MockReranker::new(&[]), // uniform → preserves vector order
        judge(&[]),
        Arc::new(MockNotifier::default()),
        Arc::new(MockMatchRepo::default()),
    );

    h.service.detect_new_task(new_task("NEW")).await.unwrap();

    // Only the top 2 (by preserved order) are judged; C is dropped.
    assert_eq!(
        judged_right_sides(&h.judge),
        vec!["cand-a".to_string(), "cand-b".to_string()]
    );
}

#[tokio::test]
async fn detect_uses_rerank_order_to_pick_judged_candidate() {
    let config = TaskDedupConfig {
        max_judge_candidates: 1,
        ..Default::default()
    };
    let h = build(
        config,
        // A leads by vector score, but the reranker prefers B.
        MockVectorDb::with_results(vec![("A", "cand-a", 0.90), ("B", "cand-b", 0.80)]),
        MockReranker::new(&[("cand-a", 0.1), ("cand-b", 0.9)]),
        judge(&["cand-b"]),
        Arc::new(MockNotifier::default()),
        Arc::new(MockMatchRepo::default()),
    );

    h.service.detect_new_task(new_task("NEW")).await.unwrap();

    // Rerank promoted B above A, so B is the only candidate judged and matched.
    assert_eq!(judged_right_sides(&h.judge), vec!["cand-b".to_string()]);
    let upserts = h.matches.upserted_matches.lock().unwrap();
    assert_eq!(upserts.len(), 1);
    let pair = (
        upserts[0].task_id.clone(),
        upserts[0].duplicate_task_id.clone(),
    );
    assert_eq!(pair, ("B".to_string(), "NEW".to_string()));
}

#[tokio::test]
async fn detect_ignores_non_duplicate_judgement() {
    let h = build(
        TaskDedupConfig::default(),
        MockVectorDb::with_results(vec![("A", "cand-a", 0.9)]),
        MockReranker::new(&[]),
        judge(&[]), // judge says "not a duplicate"
        Arc::new(MockNotifier::default()),
        Arc::new(MockMatchRepo::default()),
    );

    let active = h.service.detect_new_task(new_task("NEW")).await.unwrap();

    assert!(active.is_empty());
    assert!(h.matches.upserted_matches.lock().unwrap().is_empty());
    assert!(h.notifier.notified.lock().unwrap().is_empty());
}

#[tokio::test]
async fn detect_closes_duplicate_component() {
    let matches = Arc::new(MockMatchRepo {
        // An existing duplicate edge pulls C into the component.
        component_extra: vec!["C".to_string()],
        ..Default::default()
    });
    let h = build(
        TaskDedupConfig::default(),
        MockVectorDb::with_results(vec![("A", "cand-a", 0.9)]),
        MockReranker::new(&[]),
        judge(&["cand-a"]),
        Arc::new(MockNotifier::default()),
        matches,
    );

    h.service.detect_new_task(new_task("NEW")).await.unwrap();

    // The full {A, C, NEW} component is closed into every pair.
    let mut pairs: Vec<(String, String)> = h
        .matches
        .upserted_matches
        .lock()
        .unwrap()
        .iter()
        .map(|m| (m.task_id.clone(), m.duplicate_task_id.clone()))
        .collect();
    pairs.sort();
    assert_eq!(
        pairs,
        vec![
            ("A".to_string(), "C".to_string()),
            ("A".to_string(), "NEW".to_string()),
            ("C".to_string(), "NEW".to_string()),
        ]
    );
}

// ---------------------------------------------------------------------------
// similarity_search
// ---------------------------------------------------------------------------

#[tokio::test]
async fn similarity_search_filters_ranks_and_persists_nothing() {
    let h = build(
        TaskDedupConfig::default(),
        MockVectorDb::with_results(vec![
            ("X", "cx", 0.9),
            ("Y", "cy", 0.5), // below floor
            ("Z", "cz", 0.8),
        ]),
        MockReranker::new(&[]),
        judge(&[]),
        Arc::new(MockNotifier::default()),
        Arc::new(MockMatchRepo::default()),
    );

    let results = h
        .service
        .similarity_search("owner", None, "title", "body")
        .await
        .unwrap();

    // Y filtered out; X and Z surface in (preserved) order.
    let ids: Vec<&str> = results.iter().map(|r| r.task_id.as_str()).collect();
    assert_eq!(ids, vec!["X", "Z"]);
    // Names are resolved via the match repo.
    assert_eq!(results[0].task_name, "X name");

    // The reranker ran on the survivors only.
    let calls = h.reranker.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].1, vec!["cx".to_string(), "cz".to_string()]);

    // The similarity path does not scope-exclude self or dismissed pairs.
    let params = h
        .vector_db
        .inner
        .last_params
        .lock()
        .unwrap()
        .clone()
        .unwrap();
    assert!(params.exclude_document_id.is_none());
    assert!(!params.exclude_dismissed);

    // Nothing was judged or persisted.
    assert!(h.judge.calls.lock().unwrap().is_empty());
    assert!(h.vector_db.inner.upserted.lock().unwrap().is_empty());
    assert!(h.matches.upserted_matches.lock().unwrap().is_empty());
}

#[tokio::test]
async fn similarity_search_orders_by_rerank_score() {
    let h = build(
        TaskDedupConfig::default(),
        MockVectorDb::with_results(vec![("X", "cx", 0.9), ("Z", "cz", 0.8)]),
        MockReranker::new(&[("cx", 0.1), ("cz", 0.9)]),
        judge(&[]),
        Arc::new(MockNotifier::default()),
        Arc::new(MockMatchRepo::default()),
    );

    let results = h
        .service
        .similarity_search("owner", None, "title", "body")
        .await
        .unwrap();

    let ids: Vec<&str> = results.iter().map(|r| r.task_id.as_str()).collect();
    assert_eq!(ids, vec!["Z", "X"]);
}

#[tokio::test]
async fn similarity_search_truncates_to_duplicate_limit() {
    let config = TaskDedupConfig {
        duplicate_limit: 2,
        ..Default::default()
    };
    let h = build(
        config,
        MockVectorDb::with_results(vec![
            ("A", "ca", 0.95),
            ("B", "cb", 0.90),
            ("C", "cc", 0.85),
        ]),
        MockReranker::new(&[]),
        judge(&[]),
        Arc::new(MockNotifier::default()),
        Arc::new(MockMatchRepo::default()),
    );

    let results = h
        .service
        .similarity_search("owner", None, "title", "body")
        .await
        .unwrap();

    let ids: Vec<&str> = results.iter().map(|r| r.task_id.as_str()).collect();
    assert_eq!(ids, vec!["A", "B"]);
}

// ---------------------------------------------------------------------------
// dismissal + lookup
// ---------------------------------------------------------------------------

#[tokio::test]
async fn dismiss_matches_dismisses_and_notifies_both_sides() {
    let matches = Arc::new(MockMatchRepo::default());
    let match_id = matches.add_active_match("D", "O");
    let h = build(
        TaskDedupConfig::default(),
        MockVectorDb::default(),
        MockReranker::new(&[]),
        judge(&[]),
        Arc::new(MockNotifier::default()),
        matches,
    );

    h.service
        .dismiss_matches("D", &[match_id], "user")
        .await
        .unwrap();

    assert!(h.service.active_duplicates("D").await.unwrap().is_empty());
    let mut notified = h.notifier.notified.lock().unwrap().clone();
    notified.sort();
    assert_eq!(notified, vec!["D".to_string(), "O".to_string()]);
}

#[tokio::test]
async fn dismiss_matches_errors_when_match_missing() {
    let h = build(
        TaskDedupConfig::default(),
        MockVectorDb::default(),
        MockReranker::new(&[]),
        judge(&[]),
        Arc::new(MockNotifier::default()),
        Arc::new(MockMatchRepo::default()),
    );

    let error = h
        .service
        .dismiss_matches("D", &[Uuid::new_v4()], "user")
        .await
        .unwrap_err();

    assert!(matches!(error, TaskDedupError::MatchNotFound));
    assert!(h.notifier.notified.lock().unwrap().is_empty());
}

#[tokio::test]
async fn ensure_match_contains_checks_membership() {
    let matches = Arc::new(MockMatchRepo::default());
    let match_id = matches.add_active_match("D", "O");
    let h = build(
        TaskDedupConfig::default(),
        MockVectorDb::default(),
        MockReranker::new(&[]),
        judge(&[]),
        Arc::new(MockNotifier::default()),
        matches,
    );

    h.service
        .ensure_match_contains("D", match_id)
        .await
        .unwrap();

    let error = h
        .service
        .ensure_match_contains("D", Uuid::new_v4())
        .await
        .unwrap_err();
    assert!(matches!(error, TaskDedupError::MatchNotFound));
}

#[tokio::test]
async fn dismiss_match_by_id_dismisses_and_notifies() {
    let matches = Arc::new(MockMatchRepo::default());
    let match_id = matches.add_active_match("D", "O");
    let h = build(
        TaskDedupConfig::default(),
        MockVectorDb::default(),
        MockReranker::new(&[]),
        judge(&[]),
        Arc::new(MockNotifier::default()),
        matches,
    );

    h.service.dismiss_match_by_id(match_id).await.unwrap();

    assert!(h.service.active_duplicates("D").await.unwrap().is_empty());
    let mut notified = h.notifier.notified.lock().unwrap().clone();
    notified.sort();
    assert_eq!(notified, vec!["D".to_string(), "O".to_string()]);
}

#[tokio::test]
async fn active_duplicates_returns_the_other_side() {
    let matches = Arc::new(MockMatchRepo::default());
    matches.add_active_match("D", "O");
    let h = build(
        TaskDedupConfig::default(),
        MockVectorDb::default(),
        MockReranker::new(&[]),
        judge(&[]),
        Arc::new(MockNotifier::default()),
        matches,
    );

    let duplicates = h.service.active_duplicates("D").await.unwrap();
    assert_eq!(duplicates.len(), 1);
    assert_eq!(duplicates[0].task_id, "O");
}
