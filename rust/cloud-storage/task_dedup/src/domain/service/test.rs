//! Service-level pipeline tests against in-memory mock ports.
//!
//! These exercise [`TaskDedupService`] end to end without a database: the repo,
//! embedder, reranker, judge, and notifier are all mocked here so each stage of
//! the retrieve → rerank → judge → persist → notify pipeline can be asserted in
//! isolation.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use uuid::Uuid;

use super::{TaskDedupConfig, TaskDedupService};
use crate::domain::models::{
    JudgeResult, NewTask, TaskDedupError, TaskDuplicate, TaskDuplicateCandidate,
    TaskSimilarityCandidate,
};
use crate::domain::ports::{
    TaskDedupNotifier, TaskDedupRepo, TaskDuplicateJudge, TaskEmbedder, TaskReranker,
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

struct MockEmbedder;

#[async_trait]
impl TaskEmbedder for MockEmbedder {
    async fn embed(&self, _content: &str) -> anyhow::Result<Vec<f32>> {
        Ok(vec![0.0; 4])
    }
}

/// Reranker that scores documents from a content→score map (default 0.0) and
/// records every call so tests can assert it ran on each path.
#[derive(Default)]
struct MockReranker {
    scores: HashMap<String, f64>,
    calls: Mutex<Vec<(String, Vec<String>)>>,
}

#[async_trait]
impl TaskReranker for MockReranker {
    async fn rerank(&self, query: &str, documents: &[String]) -> anyhow::Result<Vec<f64>> {
        self.calls
            .lock()
            .unwrap()
            .push((query.to_string(), documents.to_vec()));
        Ok(documents
            .iter()
            .map(|document| self.scores.get(document).copied().unwrap_or(0.0))
            .collect())
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

/// In-memory repo: preset retrieval results + a live match store, recording the
/// writes (embeddings, matches, trims) the service performs.
#[derive(Default)]
struct MockRepo {
    candidates: Vec<TaskDuplicateCandidate>,
    similarity_candidates: Vec<TaskSimilarityCandidate>,
    /// Extra documents `active_duplicate_component` folds in beyond the seeds,
    /// to exercise duplicate-graph closure.
    component_extra: Vec<String>,
    matches: Mutex<Vec<MatchRow>>,
    upserted_embeddings: Mutex<Vec<String>>,
    upserted_matches: Mutex<Vec<RecordedMatch>>,
    trimmed: Mutex<Vec<(String, i64)>>,
}

impl MockRepo {
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
impl TaskDedupRepo for MockRepo {
    async fn upsert_embedding(
        &self,
        document_id: &str,
        _model: &str,
        _content: &str,
        _embedding: &[f32],
    ) -> Result<(), TaskDedupError> {
        self.upserted_embeddings
            .lock()
            .unwrap()
            .push(document_id.to_string());
        Ok(())
    }

    async fn candidates(
        &self,
        _task: &NewTask,
        _embedding: &[f32],
        _limit: i64,
    ) -> Result<Vec<TaskDuplicateCandidate>, TaskDedupError> {
        Ok(self.candidates.clone())
    }

    async fn similarity_candidates(
        &self,
        _owner: &str,
        _team_id: Option<Uuid>,
        _embedding: &[f32],
        _limit: i64,
    ) -> Result<Vec<TaskSimilarityCandidate>, TaskDedupError> {
        Ok(self.similarity_candidates.clone())
    }

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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn candidate(id: &str, content: &str, vector_score: f64) -> TaskDuplicateCandidate {
    TaskDuplicateCandidate {
        document_id: id.to_string(),
        content: content.to_string(),
        vector_score,
    }
}

fn sim_candidate(id: &str, content: &str, vector_score: f64) -> TaskSimilarityCandidate {
    TaskSimilarityCandidate {
        document_id: id.to_string(),
        name: format!("{id} name"),
        content: content.to_string(),
        vector_score,
    }
}

fn new_task(document_id: &str) -> NewTask {
    NewTask {
        document_id: document_id.to_string(),
        owner: "owner".to_string(),
        team_id: None,
        title: "Query title".to_string(),
        markdown: "query body".to_string(),
    }
}

fn reranker(scores: &[(&str, f64)]) -> Arc<MockReranker> {
    Arc::new(MockReranker {
        scores: scores.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        calls: Mutex::default(),
    })
}

fn judge(duplicates: &[&str]) -> Arc<MockJudge> {
    Arc::new(MockJudge {
        duplicates: duplicates.iter().map(|s| s.to_string()).collect(),
        calls: Mutex::default(),
    })
}

fn build(
    config: TaskDedupConfig,
    repo: &Arc<MockRepo>,
    reranker: &Arc<MockReranker>,
    judge: &Arc<MockJudge>,
    notifier: &Arc<MockNotifier>,
) -> TaskDedupService {
    TaskDedupService::new(
        config,
        repo.clone(),
        Arc::new(MockEmbedder),
        reranker.clone(),
        judge.clone(),
        notifier.clone(),
    )
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
    let repo = Arc::new(MockRepo {
        candidates: vec![candidate("A", "cand-a", 0.9)],
        ..Default::default()
    });
    let reranker = reranker(&[]);
    let judge = judge(&["cand-a"]);
    let notifier = Arc::new(MockNotifier::default());
    let service = build(
        TaskDedupConfig::default(),
        &repo,
        &reranker,
        &judge,
        &notifier,
    );

    let mut active = service.detect_new_task(new_task("NEW")).await.unwrap();
    active.sort();

    // Embedding persisted for the new task.
    assert_eq!(
        *repo.upserted_embeddings.lock().unwrap(),
        vec!["NEW".to_string()]
    );

    // A single ordered match was written, tagged with the judge's model.
    let upserts = repo.upserted_matches.lock().unwrap();
    assert_eq!(upserts.len(), 1);
    assert_eq!(upserts[0].task_id, "A");
    assert_eq!(upserts[0].duplicate_task_id, "NEW");
    assert_eq!(upserts[0].judge_model.as_deref(), Some("mock-judge"));
    drop(upserts);

    // The reranker ran in the judge path.
    assert_eq!(reranker.calls.lock().unwrap().len(), 1);

    // Both sides were trimmed and notified, and returned as active.
    assert_eq!(active, vec!["A".to_string(), "NEW".to_string()]);
    let mut notified = notifier.notified.lock().unwrap().clone();
    notified.sort();
    assert_eq!(notified, vec!["A".to_string(), "NEW".to_string()]);
    let trimmed: HashSet<String> = repo
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
    let repo = Arc::new(MockRepo {
        candidates: vec![candidate("A", "cand-a", 0.9), candidate("B", "cand-b", 0.5)],
        ..Default::default()
    });
    let reranker = reranker(&[]);
    let judge = judge(&["cand-a", "cand-b"]);
    let notifier = Arc::new(MockNotifier::default());
    let service = build(
        TaskDedupConfig::default(),
        &repo,
        &reranker,
        &judge,
        &notifier,
    );

    service.detect_new_task(new_task("NEW")).await.unwrap();

    // B (0.5 < 0.74) never reaches the reranker or the judge.
    let calls = reranker.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].1, vec!["cand-a".to_string()]);
    drop(calls);
    assert_eq!(judged_right_sides(&judge), vec!["cand-a".to_string()]);
}

#[tokio::test]
async fn detect_caps_judge_calls_at_max_candidates() {
    let repo = Arc::new(MockRepo {
        candidates: vec![
            candidate("A", "cand-a", 0.90),
            candidate("B", "cand-b", 0.85),
            candidate("C", "cand-c", 0.80),
        ],
        ..Default::default()
    });
    let reranker = reranker(&[]); // uniform → preserves vector order
    let judge = judge(&[]);
    let notifier = Arc::new(MockNotifier::default());
    let config = TaskDedupConfig {
        max_judge_candidates: 2,
        ..Default::default()
    };
    let service = build(config, &repo, &reranker, &judge, &notifier);

    service.detect_new_task(new_task("NEW")).await.unwrap();

    // Only the top 2 (by preserved order) are judged; C is dropped.
    assert_eq!(
        judged_right_sides(&judge),
        vec!["cand-a".to_string(), "cand-b".to_string()]
    );
}

#[tokio::test]
async fn detect_uses_rerank_order_to_pick_judged_candidate() {
    let repo = Arc::new(MockRepo {
        // A leads by vector score, but the reranker prefers B.
        candidates: vec![
            candidate("A", "cand-a", 0.90),
            candidate("B", "cand-b", 0.80),
        ],
        ..Default::default()
    });
    let reranker = reranker(&[("cand-a", 0.1), ("cand-b", 0.9)]);
    let judge = judge(&["cand-b"]);
    let notifier = Arc::new(MockNotifier::default());
    let config = TaskDedupConfig {
        max_judge_candidates: 1,
        ..Default::default()
    };
    let service = build(config, &repo, &reranker, &judge, &notifier);

    service.detect_new_task(new_task("NEW")).await.unwrap();

    // Rerank promoted B above A, so B is the only candidate judged and matched.
    assert_eq!(judged_right_sides(&judge), vec!["cand-b".to_string()]);
    let upserts = repo.upserted_matches.lock().unwrap();
    assert_eq!(upserts.len(), 1);
    let pair = (
        upserts[0].task_id.clone(),
        upserts[0].duplicate_task_id.clone(),
    );
    assert_eq!(pair, ("B".to_string(), "NEW".to_string()));
}

#[tokio::test]
async fn detect_ignores_non_duplicate_judgement() {
    let repo = Arc::new(MockRepo {
        candidates: vec![candidate("A", "cand-a", 0.9)],
        ..Default::default()
    });
    let reranker = reranker(&[]);
    let judge = judge(&[]); // judge says "not a duplicate"
    let notifier = Arc::new(MockNotifier::default());
    let service = build(
        TaskDedupConfig::default(),
        &repo,
        &reranker,
        &judge,
        &notifier,
    );

    let active = service.detect_new_task(new_task("NEW")).await.unwrap();

    assert!(active.is_empty());
    assert!(repo.upserted_matches.lock().unwrap().is_empty());
    assert!(notifier.notified.lock().unwrap().is_empty());
}

#[tokio::test]
async fn detect_closes_duplicate_component() {
    let repo = Arc::new(MockRepo {
        candidates: vec![candidate("A", "cand-a", 0.9)],
        // An existing duplicate edge pulls C into the component.
        component_extra: vec!["C".to_string()],
        ..Default::default()
    });
    let reranker = reranker(&[]);
    let judge = judge(&["cand-a"]);
    let notifier = Arc::new(MockNotifier::default());
    let service = build(
        TaskDedupConfig::default(),
        &repo,
        &reranker,
        &judge,
        &notifier,
    );

    service.detect_new_task(new_task("NEW")).await.unwrap();

    // The full {A, C, NEW} component is closed into every pair.
    let mut pairs: Vec<(String, String)> = repo
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
    let repo = Arc::new(MockRepo {
        similarity_candidates: vec![
            sim_candidate("X", "cx", 0.9),
            sim_candidate("Y", "cy", 0.5), // below floor
            sim_candidate("Z", "cz", 0.8),
        ],
        ..Default::default()
    });
    let reranker = reranker(&[]);
    let judge = judge(&[]);
    let notifier = Arc::new(MockNotifier::default());
    let service = build(
        TaskDedupConfig::default(),
        &repo,
        &reranker,
        &judge,
        &notifier,
    );

    let results = service
        .similarity_search("owner", None, "title", "body")
        .await
        .unwrap();

    // Y filtered out; X and Z surface in (preserved) order.
    let ids: Vec<&str> = results.iter().map(|r| r.task_id.as_str()).collect();
    assert_eq!(ids, vec!["X", "Z"]);

    // The reranker ran on the survivors only.
    let calls = reranker.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].1, vec!["cx".to_string(), "cz".to_string()]);
    drop(calls);

    // Nothing was judged or persisted.
    assert!(judge.calls.lock().unwrap().is_empty());
    assert!(repo.upserted_embeddings.lock().unwrap().is_empty());
    assert!(repo.upserted_matches.lock().unwrap().is_empty());
}

#[tokio::test]
async fn similarity_search_orders_by_rerank_score() {
    let repo = Arc::new(MockRepo {
        similarity_candidates: vec![sim_candidate("X", "cx", 0.9), sim_candidate("Z", "cz", 0.8)],
        ..Default::default()
    });
    let reranker = reranker(&[("cx", 0.1), ("cz", 0.9)]);
    let judge = judge(&[]);
    let notifier = Arc::new(MockNotifier::default());
    let service = build(
        TaskDedupConfig::default(),
        &repo,
        &reranker,
        &judge,
        &notifier,
    );

    let results = service
        .similarity_search("owner", None, "title", "body")
        .await
        .unwrap();

    let ids: Vec<&str> = results.iter().map(|r| r.task_id.as_str()).collect();
    assert_eq!(ids, vec!["Z", "X"]);
}

#[tokio::test]
async fn similarity_search_truncates_to_duplicate_limit() {
    let repo = Arc::new(MockRepo {
        similarity_candidates: vec![
            sim_candidate("A", "ca", 0.95),
            sim_candidate("B", "cb", 0.90),
            sim_candidate("C", "cc", 0.85),
        ],
        ..Default::default()
    });
    let reranker = reranker(&[]);
    let judge = judge(&[]);
    let notifier = Arc::new(MockNotifier::default());
    let config = TaskDedupConfig {
        duplicate_limit: 2,
        ..Default::default()
    };
    let service = build(config, &repo, &reranker, &judge, &notifier);

    let results = service
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
    let repo = Arc::new(MockRepo::default());
    let match_id = repo.add_active_match("D", "O");
    let reranker = reranker(&[]);
    let judge = judge(&[]);
    let notifier = Arc::new(MockNotifier::default());
    let service = build(
        TaskDedupConfig::default(),
        &repo,
        &reranker,
        &judge,
        &notifier,
    );

    service
        .dismiss_matches("D", &[match_id], "user")
        .await
        .unwrap();

    assert!(service.active_duplicates("D").await.unwrap().is_empty());
    let mut notified = notifier.notified.lock().unwrap().clone();
    notified.sort();
    assert_eq!(notified, vec!["D".to_string(), "O".to_string()]);
}

#[tokio::test]
async fn dismiss_matches_errors_when_match_missing() {
    let repo = Arc::new(MockRepo::default());
    let reranker = reranker(&[]);
    let judge = judge(&[]);
    let notifier = Arc::new(MockNotifier::default());
    let service = build(
        TaskDedupConfig::default(),
        &repo,
        &reranker,
        &judge,
        &notifier,
    );

    let error = service
        .dismiss_matches("D", &[Uuid::new_v4()], "user")
        .await
        .unwrap_err();

    assert!(matches!(error, TaskDedupError::MatchNotFound));
    assert!(notifier.notified.lock().unwrap().is_empty());
}

#[tokio::test]
async fn ensure_match_contains_checks_membership() {
    let repo = Arc::new(MockRepo::default());
    let match_id = repo.add_active_match("D", "O");
    let reranker = reranker(&[]);
    let judge = judge(&[]);
    let notifier = Arc::new(MockNotifier::default());
    let service = build(
        TaskDedupConfig::default(),
        &repo,
        &reranker,
        &judge,
        &notifier,
    );

    service.ensure_match_contains("D", match_id).await.unwrap();

    let error = service
        .ensure_match_contains("D", Uuid::new_v4())
        .await
        .unwrap_err();
    assert!(matches!(error, TaskDedupError::MatchNotFound));
}

#[tokio::test]
async fn dismiss_match_by_id_dismisses_and_notifies() {
    let repo = Arc::new(MockRepo::default());
    let match_id = repo.add_active_match("D", "O");
    let reranker = reranker(&[]);
    let judge = judge(&[]);
    let notifier = Arc::new(MockNotifier::default());
    let service = build(
        TaskDedupConfig::default(),
        &repo,
        &reranker,
        &judge,
        &notifier,
    );

    service.dismiss_match_by_id(match_id).await.unwrap();

    assert!(service.active_duplicates("D").await.unwrap().is_empty());
    let mut notified = notifier.notified.lock().unwrap().clone();
    notified.sort();
    assert_eq!(notified, vec!["D".to_string(), "O".to_string()]);
}

#[tokio::test]
async fn active_duplicates_returns_the_other_side() {
    let repo = Arc::new(MockRepo::default());
    repo.add_active_match("D", "O");
    let reranker = reranker(&[]);
    let judge = judge(&[]);
    let notifier = Arc::new(MockNotifier::default());
    let service = build(
        TaskDedupConfig::default(),
        &repo,
        &reranker,
        &judge,
        &notifier,
    );

    let duplicates = service.active_duplicates("D").await.unwrap();
    assert_eq!(duplicates.len(), 1);
    assert_eq!(duplicates[0].task_id, "O");
}
