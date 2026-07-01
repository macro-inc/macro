//! Vector-score threshold sweep. Embeds every labeled pair and scores A vs B by
//! the same best-across-fields cosine the pipeline's `collapse` uses, then sweeps
//! the similarity cutoff to produce a precision/recall curve plus the average
//! precision and best-F1 cutoff. This is what lets `min_vector_similarity`
//! (currently 0.75) be chosen from data instead of set blind.
//!
//! This measures the *vector floor in isolation* — score-only prediction, no
//! judge — so it shows how separable duplicates are by embedding similarity and
//! how aggressively the floor can filter before it starves the judge of real
//! duplicates. It needs only the embedder: no judge, no database.
//!
//! `#[ignore]` — hits OpenAI. Run with `just eval`.

mod eval;

use std::collections::HashMap;

use embedding::EmbeddingModel;
use embedding::LabeledEmbedding;
use embedding::embedding_provider::openai::TextEmbedding3Small;
use eval::corpus::{embeddable, load_corpus};
use eval::harness::{EVAL_CONCURRENCY, openai_key};
use eval::metrics::sweep_report;
use futures::StreamExt;

/// Cosine similarity between two equal-length vectors.
fn cosine(a: &[f32], b: &[f32]) -> f64 {
    let mut dot = 0.0f64;
    let mut norm_a = 0.0f64;
    let mut norm_b = 0.0f64;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += f64::from(*x) * f64::from(*y);
        norm_a += f64::from(*x) * f64::from(*x);
        norm_b += f64::from(*y) * f64::from(*y);
    }
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a.sqrt() * norm_b.sqrt())
}

/// Best cosine across the field cross-product, mirroring the pipeline's
/// `collapse` (title↔title, title↔body, body↔title, body↔body → max).
fn best_similarity<const DIMS: usize>(
    a: &[LabeledEmbedding<'static, DIMS>],
    b: &[LabeledEmbedding<'static, DIMS>],
) -> f64 {
    let mut best = f64::NEG_INFINITY;
    for field_a in a {
        for field_b in b {
            best = best.max(cosine(&field_a.embedding, &field_b.embedding));
        }
    }
    if best.is_finite() { best } else { 0.0 }
}

#[tokio::test]
#[ignore = "hits OpenAI; run locally with API keys"]
async fn threshold_sweep_baseline() {
    let corpus = load_corpus();
    let embedder = TextEmbedding3Small::new(openai_key());

    // Embed each task once, keyed by id.
    let embeddings: HashMap<String, _> = futures::stream::iter(&corpus.tasks)
        .map(|task| {
            let embedder = &embedder;
            async move {
                let fields = embedder.embed(&embeddable(task)).await.expect("embed task");
                (task.id.clone(), fields)
            }
        })
        .buffer_unordered(EVAL_CONCURRENCY)
        .collect()
        .await;

    // Score each labeled pair by best cross-field cosine, paired with its label.
    let mut points: Vec<(f64, bool)> = Vec::with_capacity(corpus.pairs.len());
    for pair in &corpus.pairs {
        let (Some(a), Some(b)) = (embeddings.get(&pair.a), embeddings.get(&pair.b)) else {
            continue;
        };
        if a.is_empty() || b.is_empty() {
            continue;
        }
        points.push((best_similarity(a, b), pair.expected_duplicate));
    }

    let thresholds: Vec<f64> = (30..=95).step_by(5).map(|t| f64::from(t) / 100.0).collect();
    println!(
        "{}",
        sweep_report(
            "vector-score threshold sweep (score-only, no judge)",
            &points,
            &thresholds,
        )
    );

    // Report-only: assert only that every pair was scored, so a seeding/wiring
    // regression still fails even though quality is not gated.
    assert_eq!(
        points.len(),
        corpus.pairs.len(),
        "every labeled pair should be scored"
    );
}
