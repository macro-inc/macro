//! Isolated judge accuracy: calls the real judge directly on each labeled pair's
//! full text, with no retrieval in the loop. Comparing this against the
//! end-to-end run separates misses caused by the judge from misses caused by the
//! vector-similarity floor dropping a candidate before the judge ever sees it.
//!
//! `#[ignore]` — hits Anthropic. Run with `just eval` (see `task_dedup/justfile`).


use crate::util::corpus::{full_text, load_corpus};
use crate::util::harness::{EVAL_CONCURRENCY, openai_key};
use crate::util::metrics::{PairOutcome, report};
use futures::StreamExt;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use task_dedup::domain::ports::TaskDuplicateJudge;
use task_dedup::outbound::judge::AgentDuplicateJudge;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "hits Anthropic; run locally with API keys"]
async fn judge_accuracy_baseline(pool: PgPool) {
    // Fail early with a clear message if the embedder key (and thus the router's
    // keys) are not set.
    let _ = openai_key();
    let corpus = load_corpus();
    let judge = AgentDuplicateJudge::new(ai_usage::pg_recorder(pool.clone()));

    let outcomes: Vec<PairOutcome> = futures::stream::iter(&corpus.pairs)
        .map(|pair| {
            let judge = &judge;
            let corpus = &corpus;
            async move {
                let task_a = corpus.task(&pair.a).expect("pair task a exists");
                let task_b = corpus.task(&pair.b).expect("pair task b exists");
                let result = judge
                    .judge(
                        &full_text(&task_a.title, &task_a.body),
                        &full_text(&task_b.title, &task_b.body),
                    )
                    .await;
                PairOutcome {
                    a: pair.a.clone(),
                    b: pair.b.clone(),
                    case: pair.case,
                    expected: pair.expected_duplicate,
                    predicted: result.is_duplicate,
                    detail: result.reason.unwrap_or_else(|| "<no reason>".to_string()),
                }
            }
        })
        .buffer_unordered(EVAL_CONCURRENCY)
        .collect()
        .await;

    println!(
        "{}",
        report("isolated judge accuracy (no retrieval)", &outcomes)
    );
    assert_eq!(outcomes.len(), corpus.pairs.len());
}
