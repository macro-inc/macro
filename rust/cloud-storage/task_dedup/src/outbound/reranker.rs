//! Reranker adapters for task duplicate detection.

use async_trait::async_trait;

use crate::domain::ports::TaskReranker;

/// No-op reranker: assigns every document the same score, leaving the upstream
/// vector-similarity ordering untouched (the service sorts stably).
///
/// This is the default until a real cross-encoder is wired up. A production
/// implementation — e.g. a Cohere rerank connection — implements the same
/// [`TaskReranker`] port and can be swapped in without touching the service.
pub struct NoOpTaskReranker;

#[async_trait]
impl TaskReranker for NoOpTaskReranker {
    async fn rerank(&self, _query: &str, documents: &[String]) -> anyhow::Result<Vec<f64>> {
        Ok(vec![0.0; documents.len()])
    }
}
