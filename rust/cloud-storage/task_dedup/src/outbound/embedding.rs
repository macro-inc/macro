//! Embedding adapter for task duplicate detection.
//!
//! Embeddings are produced exclusively by OpenAI through the [`async-openai`]
//! client. There is deliberately no local/offline fallback: if OpenAI is
//! unavailable the call errors so the caller can skip (live path) or retry
//! (backfill) rather than silently writing a non-comparable vector into the
//! shared pgvector column.
//!
//! [`async-openai`]: https://docs.rs/async-openai

use anyhow::Context;
use async_openai::Client;
use async_openai::config::OpenAIConfig;
use async_openai::error::OpenAIError;
use async_openai::types::embeddings::{CreateEmbeddingRequestArgs, EmbeddingInput};
use async_trait::async_trait;

use crate::domain::ports::TaskEmbedder;

/// Expected embedding dimensions for the current default embedding model.
pub const EMBEDDING_DIM: usize = 1536;

/// Why a batch embedding request could not be produced.
///
/// This is the only OpenAI-derived type the crate exposes: callers (e.g. the
/// embedding backfill) classify a failure as worth retrying versus worth
/// isolating without depending on `async-openai` themselves.
#[derive(Debug, thiserror::Error)]
pub enum EmbedError {
    /// The request was rejected and retrying it unchanged will not help — e.g.
    /// an input over the model's token limit. Splitting the batch can isolate
    /// the offending input.
    #[error("openai rejected the embeddings request: {0}")]
    Fatal(String),
    /// A transient failure (rate limit, 5xx, network, or a malformed response)
    /// that is worth retrying later.
    #[error("openai embeddings temporarily unavailable: {0}")]
    Transient(String),
}

impl From<OpenAIError> for EmbedError {
    fn from(error: OpenAIError) -> Self {
        match error {
            // 4xx request rejections (e.g. context-length-exceeded) come back as
            // an ApiError tagged `invalid_request_error`; retrying won't help.
            OpenAIError::ApiError(api)
                if api.r#type.as_deref() == Some("invalid_request_error") =>
            {
                EmbedError::Fatal(api.to_string())
            }
            // Our own request/response validation (bad dimensions, count
            // mismatch, builder errors): the specific request is unusable, so
            // treat it as fatal and let bisection isolate it.
            OpenAIError::InvalidArgument(message) => EmbedError::Fatal(message),
            // Everything else — server errors the client already retried, rate
            // limits, network errors, malformed bodies — is transient.
            other => EmbedError::Transient(other.to_string()),
        }
    }
}

/// Embeds task text with OpenAI's embeddings API.
///
/// The [`async-openai`](https://docs.rs/async-openai) client owns request
/// construction, response parsing, and rate-limit/5xx backoff. This type only
/// adds the project-specific concern of validating the vector dimensionality
/// before it reaches the fixed-width pgvector column.
pub struct OpenAiTaskEmbedder {
    model: String,
    client: Client<OpenAIConfig>,
}

impl OpenAiTaskEmbedder {
    /// Builds an embedder for the given model, reading `OPENAI_API_KEY` from the
    /// environment if present.
    ///
    /// Unlike [`Self::from_env`] this never fails to construct: when the key is
    /// missing the embedder is still created and every embed call fails loudly
    /// at request time. This keeps long-lived services (which build the embedder
    /// during startup) booting in environments where embeddings are optional,
    /// without ever degrading to a local fallback vector.
    pub fn new(model: impl Into<String>) -> Self {
        let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
        if api_key.trim().is_empty() {
            tracing::warn!(
                "OPENAI_API_KEY is not set; task embeddings will fail until it is configured"
            );
        }
        Self::with_api_key(model, api_key)
    }

    /// Builds an embedder, requiring `OPENAI_API_KEY` to be set and non-empty.
    ///
    /// Intended for one-off jobs (e.g. the embedding backfill) that should fail
    /// immediately rather than start without a working embedder.
    pub fn from_env(model: impl Into<String>) -> anyhow::Result<Self> {
        let api_key = std::env::var("OPENAI_API_KEY")
            .map_err(|_| anyhow::anyhow!("OPENAI_API_KEY must be set for the task embedder"))?;
        anyhow::ensure!(!api_key.trim().is_empty(), "OPENAI_API_KEY is empty");
        Ok(Self::with_api_key(model, api_key))
    }

    fn with_api_key(model: impl Into<String>, api_key: String) -> Self {
        let config = OpenAIConfig::new().with_api_key(api_key);
        Self {
            model: model.into(),
            client: Client::with_config(config),
        }
    }

    /// Embeds a batch of inputs in a single request, returning one vector per
    /// input in the same order. Returns an empty vec for an empty input.
    ///
    /// The underlying client retries rate limits and 5xx responses with
    /// exponential backoff. Remaining failures are classified into
    /// [`EmbedError::Transient`] (retry later) and [`EmbedError::Fatal`] (e.g.
    /// an input over the token limit — isolate it) so backfills can react.
    pub async fn embed_batch(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, EmbedError> {
        if inputs.is_empty() {
            return Ok(Vec::new());
        }

        let request = CreateEmbeddingRequestArgs::default()
            .model(self.model.clone())
            .input(EmbeddingInput::StringArray(inputs.to_vec()))
            .build()?;

        let mut response = self.client.embeddings().create(request).await?;

        if response.data.len() != inputs.len() {
            return Err(EmbedError::Fatal(format!(
                "expected {} embeddings, got {}",
                inputs.len(),
                response.data.len()
            )));
        }

        // OpenAI tags each embedding with its input index; sort so the returned
        // order matches `inputs` regardless of response ordering.
        response.data.sort_by_key(|embedding| embedding.index);

        response
            .data
            .into_iter()
            .map(|embedding| {
                if embedding.embedding.len() != EMBEDDING_DIM {
                    return Err(EmbedError::Fatal(format!(
                        "expected {EMBEDDING_DIM} embedding dimensions, got {}",
                        embedding.embedding.len()
                    )));
                }
                Ok(embedding.embedding)
            })
            .collect()
    }
}

#[async_trait]
impl TaskEmbedder for OpenAiTaskEmbedder {
    async fn embed(&self, content: &str) -> anyhow::Result<Vec<f32>> {
        let inputs = [content.to_string()];
        self.embed_batch(&inputs)
            .await?
            .pop()
            .context("OpenAI returned no embedding for input")
    }
}

/// Deterministic, offline embedder used only by tests so duplicate-detection
/// logic can be exercised without calling OpenAI.
#[cfg(test)]
pub struct LocalTaskEmbedder;

#[cfg(test)]
#[async_trait]
impl TaskEmbedder for LocalTaskEmbedder {
    async fn embed(&self, content: &str) -> anyhow::Result<Vec<f32>> {
        Ok(local_embedding(content))
    }
}

/// Deterministic local embedding used only by tests. Hashes each token into a
/// fixed bucket so semantically identical inputs produce identical vectors,
/// which is enough for the pgvector similarity tests.
#[cfg(test)]
pub fn local_embedding(text: &str) -> Vec<f32> {
    let mut vector = vec![0.0_f32; EMBEDDING_DIM];
    for token in text
        .split(|ch: char| !ch.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|token| token.len() > 2)
    {
        let mut hash = 1469598103934665603_u64;
        for byte in token.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(1099511628211);
        }
        let idx = (hash as usize) % EMBEDDING_DIM;
        let sign = if hash & 1 == 0 { 1.0 } else { -1.0 };
        vector[idx] += sign;
    }

    let norm = vector
        .iter()
        .map(|value| value * value)
        .sum::<f32>()
        .sqrt()
        .max(1.0);
    for value in &mut vector {
        *value /= norm;
    }
    vector
}
