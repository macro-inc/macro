//! Retrieval recall at production-relevant cutoffs. Seeds and embeds the whole
//! corpus, then for each expected-duplicate pair finds the rank of the true match
//! in B's similarity search and reports recall@k across a range of k.
//!
//! The existing retrieval-recall test answers "is the match retrievable at all"
//! (a very large limit); this answers "is it retrievable at the k production
//! actually uses" (`vector_candidate_limit` = 24) — a match ranked 40th exists
//! but is invisible to the judge, so recall@300 can look healthy while recall@24
//! quietly drops duplicates. One search per pair yields the rank once, so every k
//! is read off the same ranking.
//!
//! `#[ignore]` — hits OpenAI. Run with `just eval`.


use embedding::embedding_provider::openai::TextEmbedding3Small;
use embedding::{EmbeddingModel, VectorStore};
use crate::util::corpus::{embeddable, load_corpus, seed_ids};
use crate::util::harness::{EVAL_CONCURRENCY, build_service, openai_key};
use crate::util::metrics::{fmt_ratio, recall_at_k};
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
async fn recall_at_k_baseline(pool: PgPool) {
    let corpus = load_corpus();
    let ids = seed_ids(&corpus);
    seed_documents(&pool, &corpus, &ids).await;

    let embedder = TextEmbedding3Small::new(openai_key());
    let vector_db = PgTaskVectorDb::new(pool.clone());
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

    // Retrieve the full ranking (no floor, large limit) so one search per pair
    // yields the rank of the true match, from which every k is read off.
    let service = build_service(
        &pool,
        TaskDedupConfig {
            vector_candidate_limit: 500,
            duplicate_limit: 500,
            min_vector_similarity: f64::NEG_INFINITY,
            min_rerank_score: f64::NEG_INFINITY,
            ..TaskDedupConfig::default()
        },
    );

    let positives: Vec<_> = corpus
        .pairs
        .iter()
        .filter(|pair| pair.expected_duplicate)
        .collect();

    // Rank of each positive's true match (A) in B's ranked results, excluding B
    // itself so the rank matches production, where detection excludes the query.
    let ranks: Vec<Option<usize>> = futures::stream::iter(&positives)
        .map(|pair| {
            let service = &service;
            let corpus = &corpus;
            let ids = &ids;
            async move {
                let task_b = corpus.task(&pair.b).expect("task b");
                let a_id = &ids[&pair.a];
                let b_id = &ids[&pair.b];
                let results = service
                    .similarity_search(
                        EVAL_OWNER,
                        None,
                        &task_b.title,
                        &EmbeddingMarkdown::from_client_trusted(task_b.body.clone()),
                    )
                    .await
                    .expect("similarity_search");
                results
                    .iter()
                    .filter(|result| &result.task_id != b_id)
                    .position(|result| &result.task_id == a_id)
            }
        })
        .buffer_unordered(EVAL_CONCURRENCY)
        .collect()
        .await;

    // The production retrieval cutoff, read from the config rather than copied.
    let prod_k = TaskDedupConfig::default().vector_candidate_limit as usize;
    let ks = [1usize, 5, 10, prod_k, 50, 100, 300];
    println!(
        "\n===== retrieval recall@k on {} expected-duplicate pairs =====",
        positives.len()
    );
    for k in ks {
        let tag = if k == prod_k {
            "   <- production vector_candidate_limit"
        } else {
            ""
        };
        println!("  recall@{k:<4} {}{tag}", fmt_ratio(recall_at_k(&ranks, k)));
    }
    let retrieved = ranks.iter().filter(|rank| rank.is_some()).count();
    println!("  retrieved at all: {retrieved}/{}", ranks.len());

    assert!(!positives.is_empty(), "corpus has no positive pairs");
}
