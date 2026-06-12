//! Reranker adapters for task duplicate detection.

use embedding::{Content, RerankModel, Reranked, SearchResults};

/// No-op reranker: preserves the upstream vector-similarity ordering by handing
/// every candidate back in input order, carrying its existing vector-similarity
/// score through unchanged.
///
/// This is the default until a real cross-encoder is wired up. A production
/// implementation — e.g. a Cohere rerank connection — implements the same
/// [`RerankModel`] and can be swapped in without touching the service.
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
