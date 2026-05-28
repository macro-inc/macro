//! Embedding adapters for task duplicate detection.

use async_trait::async_trait;
use serde_json::json;

use crate::domain::ports::TaskEmbedder;

/// Expected embedding dimensions for the current default embedding model.
pub const EMBEDDING_DIM: usize = 1536;

/// Embedder that uses OpenAI when `OPENAI_API_KEY` is set and falls back to a
/// deterministic local embedding otherwise.
pub struct OpenAiOrLocalTaskEmbedder {
    model: String,
    client: reqwest::Client,
}

impl OpenAiOrLocalTaskEmbedder {
    /// Creates a new embedder.
    pub fn new(model: impl Into<String>) -> Self {
        Self {
            model: model.into(),
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl TaskEmbedder for OpenAiOrLocalTaskEmbedder {
    async fn embed(&self, content: &str) -> anyhow::Result<Vec<f32>> {
        let Ok(api_key) = std::env::var("OPENAI_API_KEY") else {
            return Ok(local_embedding(content));
        };

        if api_key.trim().is_empty() {
            return Ok(local_embedding(content));
        }

        let response = self
            .client
            .post("https://api.openai.com/v1/embeddings")
            .bearer_auth(api_key)
            .json(&json!({
                "model": self.model,
                "input": content,
            }))
            .send()
            .await;

        let response = match response.and_then(reqwest::Response::error_for_status) {
            Err(error) => {
                tracing::warn!(error=?error, "OpenAI embedding failed; using local task embedding");
                return Ok(local_embedding(content));
            }
            Ok(response) => response,
        };

        let response: serde_json::Value = match response.json().await {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(error=?error, "OpenAI embedding JSON failed; using local task embedding");
                return Ok(local_embedding(content));
            }
        };

        let embedding = response["data"][0]["embedding"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("OpenAI embedding response missing data[0].embedding"))?
            .iter()
            .map(|value| {
                value
                    .as_f64()
                    .map(|number| number as f32)
                    .ok_or_else(|| anyhow::anyhow!("OpenAI embedding value was not a number"))
            })
            .collect::<anyhow::Result<Vec<_>>>()?;

        anyhow::ensure!(
            embedding.len() == EMBEDDING_DIM,
            "expected {EMBEDDING_DIM} embedding dimensions, got {}",
            embedding.len()
        );

        Ok(embedding)
    }
}

/// Deterministic local embedder for tests and offline development.
pub struct LocalTaskEmbedder;

#[async_trait]
impl TaskEmbedder for LocalTaskEmbedder {
    async fn embed(&self, content: &str) -> anyhow::Result<Vec<f32>> {
        Ok(local_embedding(content))
    }
}

/// Deterministic local embedding used for tests and API fallback.
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
