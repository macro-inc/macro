//! Test-only reranker for the semantic evals.

use embedding::{Content, RerankModel, Reranked, SearchResults};

/// No-op reranker: preserves the upstream vector-similarity ordering by handing
/// every candidate back in input order, carrying its existing vector-similarity
/// score through unchanged.
///
/// The evals use it so measurements isolate embedding + judge quality without a
/// reranking model (or its API key) in the loop; production uses
/// `task_dedup::outbound::cohere::CohereReranker`.
#[derive(Clone, Copy, Default)]
pub struct NoOpReranker;

impl<const DIMS: usize> RerankModel<DIMS> for NoOpReranker {
    async fn rerank<'a, T: Send>(
        &self,
        _query: Content<'a>,
        candidates: Vec<SearchResults<T, DIMS>>,
    ) -> anyhow::Result<Vec<Reranked<T>>> {
        Ok(candidates
            .into_iter()
            .map(|result| {
                // Pass the best vector-similarity score through unchanged rather
                // than imposing a rerank score of our own.
                let score = result
                    .matches
                    .iter()
                    .map(|matched| matched.score)
                    .fold(f32::NEG_INFINITY, f32::max);
                Reranked {
                    item: result.metadata,
                    score,
                }
            })
            .collect())
    }
}
