//! Rerank-score floor for the draft similarity search. Seeds and embeds the
//! whole corpus (all real tasks act as distractors), then for every labeled
//! pair retrieves candidates exactly as the endpoint does and scores them with
//! the **production Cohere reranker** — the floor gates Cohere relevance
//! scores, so unlike the other measurements this one cannot substitute the
//! no-op reranker. Sweeping a cutoff over the true counterpart's score shows
//! how much below-floor noise each candidate floor trims and where recall
//! starts to drop, so `min_rerank_score` is chosen from data: the highest floor
//! that still returns every expected duplicate (100% recall), taken low
//! deliberately since the composer would rather show a weak match than hide a
//! real duplicate.
//!
//! The production floor is then gated: the test fails if any expected-duplicate
//! pair scores below `TaskDedupConfig::default().min_rerank_score`, so a floor
//! bump that would hide a known duplicate can't land silently.
//!
//! `#[ignore]` — hits OpenAI and Cohere. Run with `just eval`.

use std::collections::HashMap;

use embedding::embedding_provider::openai::{DIMS, TextEmbedding3Small};
use embedding::{Content, EmbeddingModel, KeyedEmbedding, RerankModel, VectorStore};
use futures::StreamExt;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use task_dedup::outbound::cohere::CohereReranker;
use task_dedup::outbound::postgres::PgTaskVectorDb;
use task_dedup::{TaskDedupConfig, TaskSearchParameters};

use crate::util::corpus::{embeddable, full_text, load_corpus, seed_ids};
use crate::util::harness::{EVAL_CONCURRENCY, cohere_key, openai_key};
use crate::util::metrics::{fmt_ratio, sweep_report};
use crate::util::seed::{EVAL_OWNER, seed_documents};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../documents/fixtures", scripts("documents_test_data"))
)]
#[ignore = "hits OpenAI and Cohere; run locally with API keys"]
async fn similarity_rerank_floor_keeps_full_recall(pool: PgPool) {
    let corpus = load_corpus();
    let ids = seed_ids(&corpus);
    seed_documents(&pool, &corpus, &ids).await;

    let embedder = TextEmbedding3Small::new(openai_key());
    let vector_db = PgTaskVectorDb::new(pool.clone());
    let reranker = CohereReranker::new(cohere_key());

    // Embed the whole corpus concurrently, keeping each task's query vectors so
    // the pair measurements below reuse them instead of re-embedding.
    let embedded: Vec<(String, _)> = futures::stream::iter(&corpus.tasks)
        .map(|task| {
            let embedder = &embedder;
            async move {
                let embedding = embedder.embed(&embeddable(task)).await.expect("embed task");
                (task.id.clone(), embedding)
            }
        })
        .buffer_unordered(EVAL_CONCURRENCY)
        .collect()
        .await;
    let mut queries: HashMap<String, Vec<KeyedEmbedding<DIMS>>> = HashMap::new();
    for (corpus_id, embedding) in embedded {
        queries.insert(
            corpus_id.clone(),
            embedding
                .iter()
                .map(|field| KeyedEmbedding {
                    search_key: field.search_key,
                    embedding: field.embedding,
                })
                .collect(),
        );
        if !embedding.is_empty() {
            vector_db
                .upsert_embeddings(ids[&corpus_id].clone(), embedding)
                .await
                .expect("persist embedding");
        }
    }

    // For each labeled pair: retrieve B's candidates with no floor and a large
    // limit (excluding B itself, as production excludes the query draft by not
    // having stored it), rerank them with Cohere, and record the relevance
    // score the true counterpart A comes back with (0.0 when A is not retrieved
    // at all), plus each query's other scores so the sweep can also report how
    // much noise a floor trims.
    let outcomes: Vec<(f64, bool, Vec<f64>, &task_dedup::eval::LabeledPair)> =
        futures::stream::iter(&corpus.pairs)
        .map(|pair| {
            let vector_db = &vector_db;
            let reranker = &reranker;
            let corpus = &corpus;
            let ids = &ids;
            let queries = &queries;
            async move {
                let task_b = corpus.task(&pair.b).expect("task b");
                let a_id = &ids[&pair.a];
                let b_id = &ids[&pair.b];
                // Rebuild the query per pair: `KeyedEmbedding` is not `Clone`,
                // but its fields are `Copy`.
                let query: Vec<KeyedEmbedding<DIMS>> = queries[&pair.b]
                    .iter()
                    .map(|field| KeyedEmbedding {
                        search_key: field.search_key,
                        embedding: field.embedding,
                    })
                    .collect();
                if query.is_empty() {
                    return (0.0, pair.expected_duplicate, Vec::new(), pair);
                }
                let results = vector_db
                    .cosine_search(
                        query,
                        TaskSearchParameters {
                            owner: EVAL_OWNER.to_string(),
                            team_id: None,
                            limit: 500,
                            exclude_document_id: Some(b_id.clone()),
                            exclude_dismissed: false,
                        },
                    )
                    .await
                    .expect("cosine_search");
                if results.is_empty() {
                    return (0.0, pair.expected_duplicate, Vec::new(), pair);
                }
                let reranked = reranker
                    .rerank(
                        Content::Owned(full_text(&task_b.title, &task_b.body)),
                        results,
                    )
                    .await
                    .expect("cohere rerank");
                let score = reranked
                    .iter()
                    .find(|scored| &scored.item == a_id)
                    .map_or(0.0, |scored| f64::from(scored.score));
                let others: Vec<f64> = reranked
                    .iter()
                    .filter(|scored| &scored.item != a_id)
                    .map(|scored| f64::from(scored.score))
                    .collect();
                (score, pair.expected_duplicate, others, pair)
            }
        })
        .buffered(EVAL_CONCURRENCY)
        .collect()
        .await;

    let points: Vec<(f64, bool)> = outcomes
        .iter()
        .map(|(score, expected, _, _)| (*score, *expected))
        .collect();
    let thresholds: Vec<f64> = (5..=95).step_by(5).map(|t| f64::from(t) / 100.0).collect();
    println!(
        "{}",
        sweep_report(
            "similarity-search rerank-score floor sweep (Cohere relevance scores)",
            &points,
            &thresholds,
        )
    );

    // How much each floor trims: mean non-counterpart results per query that
    // would still be returned. The floor's payoff is shrinking this without
    // touching recall.
    let queries_measured = outcomes.len().max(1);
    println!(" floor   mean other results returned per query");
    for &threshold in &thresholds {
        let kept: usize = outcomes
            .iter()
            .map(|(_, _, others, _)| others.iter().filter(|score| **score >= threshold).count())
            .sum();
        println!(
            "  {threshold:>4.2}   {:.1}",
            kept as f64 / queries_measured as f64
        );
    }

    // The floor is set by the weakest-scoring true duplicates, so list them:
    // these are the pairs a higher floor would hide from the composer.
    let mut weakest: Vec<(&f64, &task_dedup::eval::LabeledPair)> = outcomes
        .iter()
        .filter(|(_, expected, _, _)| *expected)
        .map(|(score, _, _, pair)| (score, *pair))
        .collect();
    weakest.sort_by(|left, right| left.0.total_cmp(right.0));
    println!("\nlowest-scoring expected duplicates (score, case, B -> A):");
    for (score, pair) in weakest.iter().take(8) {
        let title = |id: &str| corpus.task(id).map_or("?", |task| task.title.as_str());
        println!(
            "  {score:.3}  [{}] {} ({:?}) -> {} ({:?})",
            pair.case.label(),
            pair.b,
            title(&pair.b),
            pair.a,
            title(&pair.a),
        );
    }

    let floor = TaskDedupConfig::default().min_rerank_score;
    let positives: Vec<&(f64, bool)> = points.iter().filter(|(_, expected)| *expected).collect();
    let recalled = positives
        .iter()
        .filter(|(score, _)| *score >= floor)
        .count();
    let min_positive = positives
        .iter()
        .map(|(score, _)| *score)
        .fold(f64::INFINITY, f64::min);
    println!(
        "\nproduction min_rerank_score={floor:.2}: recall {recalled}/{} ({}), lowest positive score {min_positive:.3}",
        positives.len(),
        fmt_ratio((!positives.is_empty()).then(|| recalled as f64 / positives.len() as f64)),
    );

    assert!(!positives.is_empty(), "corpus has no positive pairs");
    assert_eq!(
        recalled,
        positives.len(),
        "every expected duplicate must survive the production rerank floor \
         ({floor:.2}); lowest positive score was {min_positive:.3}"
    );
}
