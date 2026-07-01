//! End-to-end duplicate detection against the whole corpus. The entire labeled
//! corpus is seeded and embedded once under a single owner — exactly production's
//! shape — and then for each labeled pair we run the real `detect_new_task(B)`
//! (embed → vector-floor → rerank → judge → persist) and check whether the
//! pipeline links A and B. This is the headline false-positive / false-negative
//! measurement.
//!
//! Crucially, B's retrieval faces the *full corpus* as distractors, not just A,
//! so the judge sees realistic top-k candidates and the false-positive rate
//! reflects production rather than an isolated two-task store. Between pairs we
//! reset only the persisted match graph (`reset_matches`): the embeddings and
//! documents stay put, so retrieval load is unchanged, but each pair's decision
//! is scored independently (no match carries over to contaminate the next pair).
//!
//! Because the shared match graph is reset between pairs, the pairs run
//! sequentially. Only the one-time corpus embedding is parallelized.
//!
//! `#[ignore]` — hits OpenAI + Anthropic. Run with `just eval`.

mod eval;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use embedding::embedding_provider::openai::TextEmbedding3Small;
use embedding::{EmbeddingModel, VectorStore};
use eval::corpus::{embeddable, load_corpus, seed_ids};
use eval::harness::{EVAL_CONCURRENCY, build_service, openai_key};
use eval::metrics::{PairOutcome, report};
use eval::seed::{EVAL_OWNER, reset_matches, seed_documents};
use futures::StreamExt;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use task_dedup::outbound::postgres::PgTaskVectorDb;
use task_dedup::{EmbeddingMarkdown, NewTask, TaskDedupConfig};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../documents/fixtures", scripts("documents_test_data"))
)]
#[ignore = "hits OpenAI + Anthropic; run locally with API keys"]
async fn end_to_end_detection_baseline(pool: PgPool) {
    let corpus = load_corpus();
    let ids = seed_ids(&corpus);
    seed_documents(&pool, &corpus, &ids).await;

    // Embed the whole corpus once (network-bound), then persist so every task is
    // a retrieval distractor for every pair's detection.
    let embedder = TextEmbedding3Small::new(openai_key());
    let vector_db = PgTaskVectorDb::new(pool.clone());

    // Progress logging for the *concurrent* embed loop. `buffer_unordered` runs
    // up to `EVAL_CONCURRENCY` embeds at once and completes them out of order, so
    // the counter is an `AtomicUsize` (correct regardless of finish order) and
    // each line is a single self-contained `eprintln!` (write-atomic, so
    // interleaved concurrent lines never tear).
    let total_tasks = corpus.tasks.len();
    let embed_started = Instant::now();
    let embed_done = AtomicUsize::new(0);
    eprintln!("[end_to_end] embedding {total_tasks} corpus tasks (concurrency {EVAL_CONCURRENCY})");
    let embedded: Vec<(String, _)> = futures::stream::iter(&corpus.tasks)
        .map(|task| {
            let embedder = &embedder;
            let ids = &ids;
            let embed_done = &embed_done;
            async move {
                let embedding = embedder.embed(&embeddable(task)).await.expect("embed task");
                let done = embed_done.fetch_add(1, Ordering::Relaxed) + 1;
                if done.is_multiple_of(25) || done == total_tasks {
                    eprintln!(
                        "[end_to_end] embedded {done}/{total_tasks} tasks ({:.0}s)",
                        embed_started.elapsed().as_secs_f64(),
                    );
                }
                (ids[&task.id].clone(), embedding)
            }
        })
        .buffer_unordered(EVAL_CONCURRENCY)
        .collect()
        .await;
    for (doc_id, embedding) in embedded {
        if !embedding.is_empty() {
            vector_db
                .upsert_embeddings(doc_id, embedding)
                .await
                .expect("persist embedding");
        }
    }

    let service = build_service(&pool, TaskDedupConfig::default());

    // Sequential: each pair detects B against the full corpus, then the match
    // graph is reset so the next pair's decision starts clean.
    //
    // The progress logging below is written to stay correct if this loop is ever
    // parallelized: the done-count is an `AtomicUsize` (accurate regardless of
    // completion order) and each pair emits one self-contained `eprintln!`
    // carrying its own identity (case + both ids), so interleaved concurrent
    // lines never tear and remain individually interpretable. (The loop itself
    // stays sequential — see the module docs: the shared match graph is reset
    // between pairs, so concurrent pairs would contaminate each other.)
    let total_pairs = corpus.pairs.len();
    let detect_started = Instant::now();
    let completed = AtomicUsize::new(0);
    eprintln!("[end_to_end] detecting {total_pairs} labeled pairs against the full corpus");
    let mut outcomes = Vec::with_capacity(corpus.pairs.len());
    for pair in &corpus.pairs {
        let pair_started = Instant::now();
        let task_b = corpus.task(&pair.b).expect("pair task b exists");
        let a_id = ids[&pair.a].clone();
        let b_id = ids[&pair.b].clone();

        service
            .detect_new_task(NewTask {
                document_id: b_id.clone(),
                owner: EVAL_OWNER.to_string(),
                team_id: None,
                title: task_b.title.clone(),
                markdown: EmbeddingMarkdown::from_client_trusted(task_b.body.clone()),
            })
            .await
            .expect("detect_new_task");

        let duplicates = service
            .active_duplicates(&b_id)
            .await
            .expect("active_duplicates");
        let matched = duplicates.iter().find(|d| d.task_id == a_id);
        let predicted = matched.is_some();
        let detail = match matched {
            Some(d) => format!(
                "vector_score={:.3} judge_reason={}",
                d.vector_score,
                d.judge_reason.as_deref().unwrap_or("<none>")
            ),
            None => "not linked".to_string(),
        };

        let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
        eprintln!(
            "[end_to_end] {done}/{total_pairs} [{}] {} <> {}  pred={predicted} exp={}  {detail}  ({:.1}s, total {:.0}s)",
            pair.case.label(),
            pair.a,
            pair.b,
            pair.expected_duplicate,
            pair_started.elapsed().as_secs_f64(),
            detect_started.elapsed().as_secs_f64(),
        );

        outcomes.push(PairOutcome {
            a: pair.a.clone(),
            b: pair.b.clone(),
            case: pair.case,
            expected: pair.expected_duplicate,
            predicted,
            detail,
        });

        // Clear the match graph so a link found for this pair can't leak into the
        // next pair's `active_duplicates` (retrieval load is unaffected).
        reset_matches(&pool).await;
    }

    println!(
        "{}",
        report(
            "end-to-end duplicate detection (production config, full-corpus distractors)",
            &outcomes
        )
    );

    // Report-only baseline: dedup is known-imperfect, so we don't gate on
    // quality here. Assert only that every labeled pair was measured, so a
    // silent seeding/wiring regression still fails.
    assert_eq!(outcomes.len(), corpus.pairs.len());
}
