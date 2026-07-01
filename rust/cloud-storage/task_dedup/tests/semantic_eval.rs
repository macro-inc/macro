//! Semantic evaluation of the task duplicate-detection pipeline.
//!
//! Unlike the in-memory service tests (which check wiring) and the pgvector
//! tests (which use a deterministic offline embedder), this suite runs the
//! **real** pipeline — OpenAI `text-embedding-3-small` embeddings and the
//! Anthropic judge — against a labeled corpus and reports how well it separates
//! duplicates from non-duplicates. It is the measurement foundation the dedup
//! fix iterates against.
//!
//! The corpus is [`EvalCorpus`] JSON merged from three committed fixtures: a
//! read-only snapshot of real employee tasks (`prod.json`), hand-labeled pairs
//! over those tasks (`prod_pairs.json`), and hand-authored synthetic pairs that
//! pin the canonical cases (`synthetic.json`).
//!
//! # These tests are `#[ignore]` by default
//!
//! They cost real OpenAI + Anthropic calls and need a database, so normal CI
//! skips them. Run them locally against the local macrodb with API keys in the
//! environment:
//!
//! ```text
//! # from a nix develop shell with DATABASE_URL + the API keys exported
//! cargo test -p task_dedup --test semantic_eval -- --ignored --nocapture
//! ```
//!
//! Required environment: `DATABASE_URL` (sqlx creates an ephemeral db per test),
//! `OPENAI_API_KEY` (embeddings), and `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` +
//! `CEREBRAS_API_KEY` (the agent router the judge routes through). The
//! measurement itself never touches production.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use embedding::embedding_provider::openai::TextEmbedding3Small;
use embedding::entity::Task;
use embedding::{EmbeddingModel, VectorStore};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use task_dedup::domain::ports::{TaskDedupNotifier, TaskDuplicateJudge};
use task_dedup::eval::{CorpusTask, EvalCorpus, LabeledPair, PairCase, TaskSource};
use task_dedup::outbound::judge::AgentDuplicateJudge;
use task_dedup::outbound::postgres::{PgTaskMatchRepo, PgTaskVectorDb};
use task_dedup::outbound::reranker::NoOpReranker;
use task_dedup::{NewTask, PgTaskDedupService, TaskDedupConfig, TaskDedupService};

/// User the corpus is seeded under. The `documents_test_data` fixture creates
/// this user, and `Document.owner` is a foreign key to it. Seeding everything
/// under one owner makes all tasks mutually visible to the owner-scoped search
/// without needing team rows.
const EVAL_OWNER: &str = "macro|user@user.com";

// ---------------------------------------------------------------------------
// Corpus loading
// ---------------------------------------------------------------------------

/// Loads and merges the three committed fixtures into one corpus, panicking if
/// any labeled pair references a task that is missing.
fn load_corpus() -> EvalCorpus {
    let mut corpus = EvalCorpus::from_json(include_bytes!("../fixtures/eval/prod.json"))
        .expect("prod.json parses");
    corpus.merge(
        EvalCorpus::from_json(include_bytes!("../fixtures/eval/prod_pairs.json"))
            .expect("prod_pairs.json parses"),
    );
    corpus.merge(
        EvalCorpus::from_json(include_bytes!("../fixtures/eval/synthetic.json"))
            .expect("synthetic.json parses"),
    );

    let dangling = corpus.dangling_pair_ids();
    assert!(
        dangling.is_empty(),
        "labeled pairs reference missing tasks: {dangling:?}"
    );
    corpus
}

/// Maps each corpus task id to the document id it is seeded under.
///
/// Prod tasks keep their real UUID; synthetic tasks (readable slugs in the
/// fixture) are seeded under a generated UUID-shaped id. This matters because
/// the `task_duplicate_match_order` CHECK (`task_id < duplicate_task_id`) is
/// evaluated in the database's collation, while the service's `ordered_pair`
/// uses Rust byte ordering — the two disagree on strings with hyphens in
/// non-aligned positions (e.g. `syn-attach-drag-files` vs `syn-attach-dragdrop`).
/// Real document ids are UUIDs, whose hyphens always align, so production never
/// hits this; seeding UUID-shaped ids keeps the eval faithful to that.
fn seed_ids(corpus: &EvalCorpus) -> HashMap<String, String> {
    corpus
        .tasks
        .iter()
        .enumerate()
        .map(|(index, task)| {
            let doc_id = match task.source {
                TaskSource::Prod => task.id.clone(),
                TaskSource::Synthetic => {
                    format!("e5a10000-0000-4000-8000-{index:012x}")
                }
            };
            (task.id.clone(), doc_id)
        })
        .collect()
}

/// Joins a task's title and body the same way the service builds its judge /
/// rerank query, so isolated judge calls see exactly what the pipeline would.
fn full_text(title: &str, body: &str) -> String {
    format!("{}\n{}", title.trim(), body.trim())
}

fn embeddable(task: &CorpusTask) -> Task<'_> {
    Task {
        title: std::borrow::Cow::Borrowed(&task.title),
        body: std::borrow::Cow::Borrowed(&task.body),
    }
}

// ---------------------------------------------------------------------------
// Confusion matrix + per-case metrics (pure; unit-tested below)
// ---------------------------------------------------------------------------

/// A binary-classification tally of predicted-vs-expected duplicate verdicts.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Confusion {
    /// Expected duplicate, predicted duplicate.
    tp: u32,
    /// Expected non-duplicate, predicted duplicate (a false positive — the bug
    /// dedup is most criticized for).
    fp: u32,
    /// Expected non-duplicate, predicted non-duplicate.
    tn: u32,
    /// Expected duplicate, predicted non-duplicate (a missed duplicate).
    fn_: u32,
}

impl Confusion {
    fn record(&mut self, expected: bool, predicted: bool) {
        match (expected, predicted) {
            (true, true) => self.tp += 1,
            (false, true) => self.fp += 1,
            (false, false) => self.tn += 1,
            (true, false) => self.fn_ += 1,
        }
    }

    fn total(&self) -> u32 {
        self.tp + self.fp + self.tn + self.fn_
    }

    /// Fraction of predicted duplicates that were real. `None` when nothing was
    /// predicted duplicate.
    fn precision(&self) -> Option<f64> {
        let denom = self.tp + self.fp;
        (denom > 0).then(|| self.tp as f64 / denom as f64)
    }

    /// Fraction of real duplicates that were caught. `None` when there were no
    /// real duplicates.
    fn recall(&self) -> Option<f64> {
        let denom = self.tp + self.fn_;
        (denom > 0).then(|| self.tp as f64 / denom as f64)
    }

    fn f1(&self) -> Option<f64> {
        match (self.precision(), self.recall()) {
            (Some(p), Some(r)) if p + r > 0.0 => Some(2.0 * p * r / (p + r)),
            _ => None,
        }
    }

    fn accuracy(&self) -> Option<f64> {
        let total = self.total();
        (total > 0).then(|| (self.tp + self.tn) as f64 / total as f64)
    }
}

fn fmt_ratio(value: Option<f64>) -> String {
    value.map_or_else(|| "  n/a".to_string(), |v| format!("{:.1}%", v * 100.0))
}

/// A single pair's outcome, retained so the report can list the misses.
struct PairOutcome {
    a: String,
    b: String,
    case: PairCase,
    expected: bool,
    predicted: bool,
    detail: String,
}

/// Builds the full text report for a set of pair outcomes: overall confusion
/// matrix, per-case breakdown, and the list of misclassified pairs.
fn report(title: &str, outcomes: &[PairOutcome]) -> String {
    use std::collections::BTreeMap;
    use std::fmt::Write as _;

    let mut overall = Confusion::default();
    let mut by_case: BTreeMap<&'static str, Confusion> = BTreeMap::new();
    for outcome in outcomes {
        overall.record(outcome.expected, outcome.predicted);
        by_case
            .entry(outcome.case.label())
            .or_default()
            .record(outcome.expected, outcome.predicted);
    }

    let mut out = String::new();
    let _ = writeln!(out, "\n===== {title} =====");
    let _ = writeln!(
        out,
        "pairs: {}  TP={} FP={} FN={} TN={}",
        overall.total(),
        overall.tp,
        overall.fp,
        overall.fn_,
        overall.tn,
    );
    let _ = writeln!(
        out,
        "precision={}  recall={}  f1={}  accuracy={}",
        fmt_ratio(overall.precision()),
        fmt_ratio(overall.recall()),
        fmt_ratio(overall.f1()),
        fmt_ratio(overall.accuracy()),
    );

    let _ = writeln!(out, "\nby case:");
    for (case, matrix) in &by_case {
        let correct = matrix.tp + matrix.tn;
        let _ = writeln!(
            out,
            "  {case:<34} {correct}/{} correct  (TP={} FP={} FN={} TN={})",
            matrix.total(),
            matrix.tp,
            matrix.fp,
            matrix.fn_,
            matrix.tn,
        );
    }

    let misses: Vec<&PairOutcome> = outcomes
        .iter()
        .filter(|o| o.expected != o.predicted)
        .collect();
    if misses.is_empty() {
        let _ = writeln!(out, "\nno misclassifications.");
    } else {
        let _ = writeln!(out, "\nmisclassifications ({}):", misses.len());
        for miss in misses {
            let kind = if miss.expected {
                "MISSED DUP  "
            } else {
                "FALSE POS   "
            };
            let _ = writeln!(
                out,
                "  {kind}[{}] {} <> {}\n              {}",
                miss.case.label(),
                miss.a,
                miss.b,
                miss.detail,
            );
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Seeding + real service wiring
// ---------------------------------------------------------------------------

struct NoopNotifier;

#[async_trait]
impl TaskDedupNotifier for NoopNotifier {
    async fn notify_matches_updated(&self, _document_id: &str) -> anyhow::Result<()> {
        Ok(())
    }
}

/// Inserts every corpus task as a task document owned by [`EVAL_OWNER`], under
/// its seeded document id. Does not embed anything — the individual measurements
/// embed as they need to.
async fn seed_documents(pool: &PgPool, corpus: &EvalCorpus, ids: &HashMap<String, String>) {
    for task in &corpus.tasks {
        let doc_id = &ids[&task.id];
        sqlx::query!(
            r#"INSERT INTO "Document" (id, name, "fileType", owner) VALUES ($1, $2, 'md', $3)"#,
            doc_id,
            task.title,
            EVAL_OWNER,
        )
        .execute(pool)
        .await
        .expect("insert document");

        sqlx::query!(
            r#"INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')"#,
            doc_id,
        )
        .execute(pool)
        .await
        .expect("insert document_sub_type");
    }
}

fn openai_key() -> String {
    std::env::var("OPENAI_API_KEY").expect(
        "OPENAI_API_KEY must be set to run the semantic eval; \
         export it (and ANTHROPIC_API_KEY / CEREBRAS_API_KEY for the judge) first",
    )
}

/// Builds the production service (real embedder + judge) over `pool` with the
/// given config. The judge records usage into the ephemeral db's ai_usage table.
fn build_service(pool: &PgPool, config: TaskDedupConfig) -> PgTaskDedupService {
    TaskDedupService::new(
        config,
        TextEmbedding3Small::new(openai_key()),
        PgTaskVectorDb::new(pool.clone()),
        NoOpReranker,
        Arc::new(AgentDuplicateJudge::new(ai_usage::pg_recorder(
            pool.clone(),
        ))),
        Arc::new(NoopNotifier),
        Arc::new(PgTaskMatchRepo::new(pool.clone())),
    )
}

async fn clear_pipeline_state(pool: &PgPool) {
    sqlx::query!("TRUNCATE TABLE task_duplicate_match")
        .execute(pool)
        .await
        .expect("truncate matches");
    sqlx::query!("TRUNCATE TABLE task_duplicate_embedding")
        .execute(pool)
        .await
        .expect("truncate embeddings");
}

// ---------------------------------------------------------------------------
// #[ignore] semantic measurements
// ---------------------------------------------------------------------------

/// End-to-end duplicate detection: for each labeled pair, seed A's embedding,
/// run the real `detect_new_task(B)` (embed → vector-floor → judge → persist) in
/// pairwise isolation, and check whether the pipeline links A and B. This is the
/// headline false-positive / false-negative measurement, mirroring production
/// behavior including the vector-similarity floor.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../documents/fixtures", scripts("documents_test_data"))
)]
#[ignore = "hits OpenAI + Anthropic; run locally with API keys"]
async fn end_to_end_detection_baseline(pool: PgPool) {
    let corpus = load_corpus();
    let ids = seed_ids(&corpus);
    seed_documents(&pool, &corpus, &ids).await;

    let seed_embedder = TextEmbedding3Small::new(openai_key());
    let vector_db = PgTaskVectorDb::new(pool.clone());
    let service = build_service(&pool, TaskDedupConfig::default());

    let mut outcomes = Vec::new();
    for pair in &corpus.pairs {
        clear_pipeline_state(&pool).await;

        let task_a = corpus.task(&pair.a).expect("pair task a exists");
        let task_b = corpus.task(&pair.b).expect("pair task b exists");
        let a_id = &ids[&task_a.id];
        let b_id = &ids[&task_b.id];

        // Seed A's embedding so it is a candidate, then detect B against it.
        let a_embedding = seed_embedder
            .embed(&embeddable(task_a))
            .await
            .expect("embed a");
        if !a_embedding.is_empty() {
            vector_db
                .upsert_embeddings(a_id.clone(), a_embedding)
                .await
                .expect("persist a embedding");
        }

        service
            .detect_new_task(NewTask {
                document_id: b_id.clone(),
                owner: EVAL_OWNER.to_string(),
                team_id: None,
                title: task_b.title.clone(),
                markdown: task_b.body.clone(),
            })
            .await
            .expect("detect_new_task");

        let duplicates = service
            .active_duplicates(b_id)
            .await
            .expect("active_duplicates");
        let matched = duplicates.iter().find(|d| d.task_id == *a_id);
        let predicted = matched.is_some();
        let detail = match matched {
            Some(d) => format!(
                "vector_score={:.3} judge_reason={}",
                d.vector_score,
                d.judge_reason.as_deref().unwrap_or("<none>")
            ),
            None => "not linked".to_string(),
        };

        outcomes.push(PairOutcome {
            a: pair.a.clone(),
            b: pair.b.clone(),
            case: pair.case,
            expected: pair.expected_duplicate,
            predicted,
            detail,
        });
    }

    let text = report(
        "end-to-end duplicate detection (production config)",
        &outcomes,
    );
    println!("{text}");

    // Report-only baseline: dedup is known-imperfect, so we don't gate on
    // quality here. Assert only that every labeled pair was measured, so a
    // silent seeding/wiring regression still fails.
    assert_eq!(outcomes.len(), corpus.pairs.len());
}

/// Isolated judge accuracy: calls the real judge directly on each labeled pair's
/// full text, with no retrieval in the loop. Comparing this against the
/// end-to-end run separates misses caused by the judge from misses caused by the
/// vector-similarity floor dropping a candidate before the judge ever sees it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "hits Anthropic; run locally with API keys"]
async fn judge_accuracy_baseline(pool: PgPool) {
    // Ensure the router's keys are present up front with a clear message.
    let _ = openai_key();
    let corpus = load_corpus();
    let judge = AgentDuplicateJudge::new(ai_usage::pg_recorder(pool.clone()));

    let mut outcomes = Vec::new();
    for pair in &corpus.pairs {
        let task_a = corpus.task(&pair.a).expect("pair task a exists");
        let task_b = corpus.task(&pair.b).expect("pair task b exists");
        let result = judge
            .judge(
                &full_text(&task_a.title, &task_a.body),
                &full_text(&task_b.title, &task_b.body),
            )
            .await;

        outcomes.push(PairOutcome {
            a: pair.a.clone(),
            b: pair.b.clone(),
            case: pair.case,
            expected: pair.expected_duplicate,
            predicted: result.is_duplicate,
            detail: result.reason.unwrap_or_else(|| "<no reason>".to_string()),
        });
    }

    let text = report("isolated judge accuracy (no retrieval)", &outcomes);
    println!("{text}");
    assert_eq!(outcomes.len(), corpus.pairs.len());
}

/// Retrieval recall: embeds the whole corpus (all ~150 real tasks act as
/// distractors), then for each *expected-duplicate* pair checks whether B's
/// similarity search surfaces A above the vector-similarity floor. Candidate and
/// duplicate limits are raised so the metric reflects "is A retrievable at all",
/// not the top-5 UI cap. Misses here are duplicates the judge would never get a
/// chance to catch.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../documents/fixtures", scripts("documents_test_data"))
)]
#[ignore = "hits OpenAI; run locally with API keys"]
async fn retrieval_recall_baseline(pool: PgPool) {
    let corpus = load_corpus();
    let ids = seed_ids(&corpus);
    seed_documents(&pool, &corpus, &ids).await;

    let embedder = TextEmbedding3Small::new(openai_key());
    let vector_db = PgTaskVectorDb::new(pool.clone());
    for task in &corpus.tasks {
        let embedding = embedder.embed(&embeddable(task)).await.expect("embed task");
        if !embedding.is_empty() {
            vector_db
                .upsert_embeddings(ids[&task.id].clone(), embedding)
                .await
                .expect("persist embedding");
        }
    }

    // Large limits: measure retrievability above the floor, not the UI top-5.
    let service = build_service(
        &pool,
        TaskDedupConfig {
            vector_candidate_limit: 300,
            duplicate_limit: 300,
            ..TaskDedupConfig::default()
        },
    );

    let positives: Vec<&LabeledPair> = corpus
        .pairs
        .iter()
        .filter(|p| p.expected_duplicate)
        .collect();

    let mut retrieved = 0usize;
    let mut lines = Vec::new();
    for pair in &positives {
        let task_a = corpus.task(&pair.a).expect("task a");
        let task_b = corpus.task(&pair.b).expect("task b");
        let results = service
            .similarity_search(EVAL_OWNER, None, &task_b.title, &task_b.body)
            .await
            .expect("similarity_search");
        let hit = results.iter().find(|r| r.task_id == ids[&task_a.id]);
        if hit.is_some() {
            retrieved += 1;
        }
        lines.push(format!(
            "  {:<12} [{}] {} -> {} ({} above floor)",
            if hit.is_some() { "RETRIEVED" } else { "MISSED" },
            pair.case.label(),
            pair.b,
            pair.a,
            results.len(),
        ));
    }

    println!("\n===== retrieval recall on expected-duplicate pairs =====");
    println!(
        "retrieved {}/{} ({})",
        retrieved,
        positives.len(),
        fmt_ratio((!positives.is_empty()).then(|| retrieved as f64 / positives.len() as f64)),
    );
    for line in lines {
        println!("{line}");
    }

    assert!(!positives.is_empty(), "corpus has no positive pairs");
}

// ---------------------------------------------------------------------------
// Offline unit tests (run in normal CI) for the metric math
// ---------------------------------------------------------------------------

#[test]
fn confusion_computes_precision_recall_f1() {
    let mut c = Confusion::default();
    c.record(true, true); // tp
    c.record(true, true); // tp
    c.record(true, false); // fn
    c.record(false, true); // fp
    c.record(false, false); // tn

    assert_eq!((c.tp, c.fp, c.fn_, c.tn), (2, 1, 1, 1));
    assert!((c.precision().unwrap() - 2.0 / 3.0).abs() < 1e-9);
    assert!((c.recall().unwrap() - 2.0 / 3.0).abs() < 1e-9);
    assert!((c.f1().unwrap() - 2.0 / 3.0).abs() < 1e-9);
    assert!((c.accuracy().unwrap() - 3.0 / 5.0).abs() < 1e-9);
}

#[test]
fn confusion_handles_empty_denominators() {
    let empty = Confusion::default();
    assert_eq!(empty.precision(), None);
    assert_eq!(empty.recall(), None);
    assert_eq!(empty.f1(), None);
    assert_eq!(empty.accuracy(), None);

    let mut only_negatives = Confusion::default();
    only_negatives.record(false, false);
    assert_eq!(only_negatives.precision(), None); // nothing predicted positive
    assert_eq!(only_negatives.recall(), None); // no real positives
}

#[test]
fn report_lists_misclassifications() {
    let outcomes = vec![
        PairOutcome {
            a: "a".into(),
            b: "b".into(),
            case: PairCase::Rephrasing,
            expected: true,
            predicted: false,
            detail: "not linked".into(),
        },
        PairOutcome {
            a: "c".into(),
            b: "d".into(),
            case: PairCase::Unrelated,
            expected: false,
            predicted: false,
            detail: "ok".into(),
        },
    ];
    let text = report("t", &outcomes);
    assert!(text.contains("MISSED DUP"));
    assert!(text.contains("rephrasing"));
    assert!(text.contains("misclassifications (1)"));
}

#[test]
fn corpus_fixtures_are_consistent() {
    // Not #[ignore]: guards the committed fixtures on every build so a bad edit
    // (dangling pair id, malformed JSON) fails fast without any API calls.
    let corpus = load_corpus();
    assert!(corpus.tasks.len() > 20, "expected a non-trivial corpus");
    assert!(!corpus.pairs.is_empty(), "expected labeled pairs");
    assert!(corpus.pairs.iter().any(|p| p.expected_duplicate));
    assert!(corpus.pairs.iter().any(|p| !p.expected_duplicate));
}
