//! Judge variance and failure accounting. The judge is a sampled LLM that
//! defaults to "not duplicate" on error, so a single call per pair (as the other
//! evals use) can neither tell a genuine "no" from a swallowed failure nor see
//! run-to-run flip-flop. This repeats the judge `REPEATS` times per boundary pair
//! and reports, per pair, how often it voted duplicate and how often the call
//! failed, plus aggregate stability and failure rates.
//!
//! Scoped to the boundary cases (positives + same-project / same-action
//! negatives). The obviously-unrelated pairs are skipped — they don't flip, and
//! running every pair `REPEATS` times would multiply judge cost for no signal;
//! the count of skipped pairs is printed so the scoping isn't silent.
//!
//! `#[ignore]` — hits Anthropic. Run with `just eval`.


use crate::util::corpus::{full_text, load_corpus};
use crate::util::harness::{EVAL_CONCURRENCY, openai_key};
use futures::StreamExt;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use task_dedup::domain::ports::TaskDuplicateJudge;
use task_dedup::eval::PairCase;
use task_dedup::outbound::judge::AgentDuplicateJudge;

/// Judge calls per boundary pair.
const REPEATS: usize = 5;

/// Substring the judge puts in its reason on the failure path (see
/// `AgentDuplicateJudge`'s unavailable replies); lets us separate a real "not
/// duplicate" verdict from a swallowed error without changing production code.
const FAILURE_MARKER: &str = "treated as not duplicate";

/// Boundary cases where the judge decision is non-trivial and can flip. The
/// unrelated / prod-observed pairs are excluded to bound cost.
fn is_boundary(case: PairCase) -> bool {
    matches!(
        case,
        PairCase::Rephrasing
            | PairCase::TerseVsDetailed
            | PairCase::LowLexicalOverlap
            | PairCase::SameProjectDifferentAction
            | PairCase::SameActionDifferentIntegration
    )
}

/// One boundary pair's judge votes across `REPEATS` runs.
struct PairStats {
    a: String,
    b: String,
    case: PairCase,
    expected: bool,
    /// Number of successful runs that returned duplicate.
    dup_votes: usize,
    /// Number of runs whose judge call failed (defaulted to not-duplicate).
    failures: usize,
}

impl PairStats {
    /// Successful (non-failed) runs.
    fn successes(&self) -> usize {
        REPEATS - self.failures
    }

    /// True when the successful runs disagreed (neither unanimous duplicate nor
    /// unanimous not-duplicate).
    fn is_unstable(&self) -> bool {
        let successes = self.successes();
        successes > 0 && self.dup_votes != 0 && self.dup_votes != successes
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "hits Anthropic; run locally with API keys"]
async fn judge_variance_baseline(pool: PgPool) {
    let _ = openai_key(); // fail fast if the router keys are unset
    let corpus = load_corpus();
    let judge = AgentDuplicateJudge::new(ai_usage::pg_recorder(pool.clone()));

    let boundary: Vec<_> = corpus
        .pairs
        .iter()
        .filter(|pair| is_boundary(pair.case))
        .collect();
    let skipped = corpus.pairs.len() - boundary.len();

    let stats: Vec<PairStats> = futures::stream::iter(&boundary)
        .map(|pair| {
            let judge = &judge;
            let corpus = &corpus;
            async move {
                let task_a = corpus.task(&pair.a).expect("task a");
                let task_b = corpus.task(&pair.b).expect("task b");
                let left = full_text(&task_a.title, &task_a.body);
                let right = full_text(&task_b.title, &task_b.body);

                // Sequential repeats keep concurrent judge calls to the outer
                // fan-out only, avoiding a REPEATS× burst against the model.
                let mut dup_votes = 0;
                let mut failures = 0;
                for _ in 0..REPEATS {
                    let result = judge.judge(&left, &right).await;
                    let failed = result
                        .reason
                        .as_deref()
                        .is_some_and(|reason| reason.contains(FAILURE_MARKER));
                    if failed {
                        failures += 1;
                    } else if result.is_duplicate {
                        dup_votes += 1;
                    }
                }

                PairStats {
                    a: pair.a.clone(),
                    b: pair.b.clone(),
                    case: pair.case,
                    expected: pair.expected_duplicate,
                    dup_votes,
                    failures,
                }
            }
        })
        .buffer_unordered(EVAL_CONCURRENCY)
        .collect()
        .await;

    let total_calls = stats.len() * REPEATS;
    let total_failures: usize = stats.iter().map(|s| s.failures).sum();
    let unstable = stats.iter().filter(|s| s.is_unstable()).count();

    println!("\n===== judge variance ({REPEATS} repeats per pair) =====");
    println!(
        "boundary pairs: {}  ({skipped} non-boundary pairs skipped)",
        stats.len()
    );
    println!(
        "judge calls: {total_calls}  failures: {total_failures} ({})",
        fmt_pct(total_failures, total_calls)
    );
    println!("unstable (non-unanimous) pairs: {unstable}/{}", stats.len());

    println!("\nper-pair votes (dup / successful runs, failures) — unstable first:");
    let mut ordered: Vec<&PairStats> = stats.iter().collect();
    ordered.sort_by_key(|s| (!s.is_unstable(), s.case.label(), s.a.clone()));
    for s in ordered {
        let flag = if s.is_unstable() {
            "UNSTABLE"
        } else {
            "        "
        };
        println!(
            "  {flag} [{}] exp={} dup {}/{} fail {}  {} <> {}",
            s.case.label(),
            s.expected,
            s.dup_votes,
            s.successes(),
            s.failures,
            s.a,
            s.b,
        );
    }

    assert_eq!(stats.len(), boundary.len());
}

/// Formats `num/denom` as a percentage, or `n/a` when `denom` is zero.
fn fmt_pct(num: usize, denom: usize) -> String {
    if denom == 0 {
        "n/a".to_string()
    } else {
        format!("{:.1}%", num as f64 / denom as f64 * 100.0)
    }
}
