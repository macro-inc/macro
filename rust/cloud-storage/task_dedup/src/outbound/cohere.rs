//! Cohere reranker adapter for task duplicate detection.

use anyhow::Context as _;
use embedding::{Content, RerankModel, Reranked, SearchResults};
use serde::Deserialize;
use serde_json::json;

#[cfg(test)]
mod test;

/// The Cohere model used for reranking unless one is supplied explicitly.
pub const DEFAULT_COHERE_RERANK_MODEL: &str = "rerank-v3.5";

const COHERE_RERANK_URL: &str = "https://api.cohere.com/v2/rerank";

/// Reranker backed by Cohere's [rerank API].
///
/// Each candidate is presented to the API as its matched field contents joined
/// back together — the same reconstruction the service uses for judging — and
/// comes back scored by relevance to the query.
///
/// [rerank API]: https://docs.cohere.com/reference/rerank
#[derive(Clone)]
pub struct CohereReranker {
    client: reqwest::Client,
    api_key: String,
    model: String,
}

impl CohereReranker {
    /// Creates a reranker authenticated with `api_key`, using
    /// [`DEFAULT_COHERE_RERANK_MODEL`].
    ///
    /// The key is used directly — nothing is read from the environment.
    pub fn new(api_key: impl Into<String>) -> Self {
        Self::with_model(api_key, DEFAULT_COHERE_RERANK_MODEL)
    }

    /// Creates a reranker authenticated with `api_key` using an explicit Cohere
    /// rerank model.
    pub fn with_model(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key: api_key.into(),
            model: model.into(),
        }
    }
}

#[derive(Deserialize)]
struct CohereRerankResponse {
    results: Vec<CohereRerankResult>,
}

#[derive(Deserialize)]
struct CohereRerankResult {
    index: usize,
    relevance_score: f32,
}

/// A candidate's matched field contents joined back together, mirroring how
/// the service reconstructs candidate text for judging.
fn document_text<T, const DIMS: usize>(result: &SearchResults<T, DIMS>) -> String {
    result
        .matches
        .iter()
        .map(|matched| matched.embedding.content.as_ref())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Reorders `candidates` by the API's relevance results, pairing each result's
/// `index` back to the candidate it scored. Rejects out-of-range and duplicate
/// indices rather than dropping or double-counting candidates.
fn order_by_relevance<T>(
    results: Vec<CohereRerankResult>,
    candidates: Vec<T>,
) -> anyhow::Result<Vec<Reranked<T>>> {
    let mut slots: Vec<Option<T>> = candidates.into_iter().map(Some).collect();
    results
        .into_iter()
        .map(|result| {
            let slot = slots
                .get_mut(result.index)
                .with_context(|| format!("Cohere returned out-of-range index {}", result.index))?;
            let item = slot
                .take()
                .with_context(|| format!("Cohere returned duplicate index {}", result.index))?;
            Ok(Reranked {
                item,
                score: result.relevance_score,
            })
        })
        .collect()
}

impl<const DIMS: usize> RerankModel<DIMS> for CohereReranker {
    async fn rerank<'a, T: Send>(
        &self,
        query: Content<'a>,
        candidates: Vec<SearchResults<T, DIMS>>,
    ) -> anyhow::Result<Vec<Reranked<T>>> {
        // The API rejects an empty document list, so short-circuit.
        if candidates.is_empty() {
            return Ok(Vec::new());
        }

        let documents: Vec<String> = candidates.iter().map(document_text).collect();
        let metadata: Vec<T> = candidates
            .into_iter()
            .map(|candidate| candidate.metadata)
            .collect();

        let response = self
            .client
            .post(COHERE_RERANK_URL)
            .bearer_auth(&self.api_key)
            .json(&json!({
                "model": self.model,
                "query": query.as_ref(),
                "documents": documents,
            }))
            .send()
            .await
            .context("Cohere rerank request failed")?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Cohere rerank returned {status}: {body}");
        }

        let body: CohereRerankResponse = response
            .json()
            .await
            .context("Cohere rerank response was not valid JSON")?;

        if body.results.len() != metadata.len() {
            anyhow::bail!(
                "Cohere returned {} results for {} documents",
                body.results.len(),
                metadata.len(),
            );
        }

        order_by_relevance(body.results, metadata)
    }
}
