//! Retrieval recall: embeds the whole corpus (all real tasks act as distractors),
//! then for each *expected-duplicate* pair checks whether B's similarity search
//! surfaces A above the vector-similarity floor. Candidate and duplicate limits
//! are raised so the metric reflects "is A retrievable at all", not the top-5 UI
//! cap. Misses here are duplicates the judge would never get a chance to catch.
//!
//! `#[ignore]` — hits OpenAI. Run with `just eval`.


use embedding::embedding_provider::openai::TextEmbedding3Small;
use embedding::{EmbeddingModel, VectorStore};
use crate::util::corpus::{embeddable, load_corpus, seed_ids};
use crate::util::harness::{EVAL_CONCURRENCY, build_service, openai_key};
use crate::util::metrics::fmt_ratio;
use crate::util::seed::{EVAL_OWNER, seed_documents};
use futures::StreamExt;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use task_dedup::outbound::postgres::PgTaskVectorDb;
use task_dedup::{EmbeddingMarkdown, TaskDedupConfig};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../documents/fixtures", scripts("documents_test_data"))
)]
#[ignore = "hits OpenAI; run locally with API keys"]
async fn retrieval_recall_baseline(pool: PgPool) {
    let corpus = load_corpus();
    let ids = seed_ids(&corpus);
    seed_documents(&pool, &corpus, &ids).await;

    let embedder = TextEmbedding3Small::new(openai_key());
    let vector_db = PgTaskVectorDb::new(pool.clone());
    // Embed the whole corpus concurrently (network-bound), then persist.
    let embedded: Vec<(String, _)> = futures::stream::iter(&corpus.tasks)
        .map(|task| {
            let embedder = &embedder;
            let ids = &ids;
            async move {
                let embedding = embedder.embed(&embeddable(task)).await.expect("embed task");
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

    // Large limits: measure retrievability above the vector floor, not the UI
    // top-5. The rerank floor is disabled so this keeps measuring what reaches
    // the detect path's judge (which has no rerank floor); the similarity
    // endpoint's floor has its own eval (`eval_similarity_rerank_floor`).
    let service = build_service(
        &pool,
        TaskDedupConfig {
            vector_candidate_limit: 300,
            duplicate_limit: 300,
            min_rerank_score: f64::NEG_INFINITY,
            ..TaskDedupConfig::default()
        },
    );

    let positives: Vec<_> = corpus
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
            .similarity_search(
                EVAL_OWNER,
                None,
                &task_b.title,
                &EmbeddingMarkdown::from_client_trusted(task_b.body.clone()),
            )
            .await
            .expect("similarity_search");
        let hit = results.iter().any(|r| r.task_id == ids[&task_a.id]);
        if hit {
            retrieved += 1;
        }
        lines.push(format!(
            "  {:<12} [{}] {} -> {} ({} above floor)",
            if hit { "RETRIEVED" } else { "MISSED" },
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
