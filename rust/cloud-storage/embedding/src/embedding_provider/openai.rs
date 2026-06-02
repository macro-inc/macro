//! [`EmbeddingModel`] backed by OpenAI's [embeddings API].
//!
//! [embeddings API]: https://platform.openai.com/docs/guides/embeddings

use std::borrow::Cow;

use anyhow::Context;
use async_openai::{
    Client,
    config::OpenAIConfig,
    types::embeddings::{CreateEmbeddingRequestArgs, EmbeddingInput},
};

use crate::{Embeddable, Embedding, EmbeddingModel, LabeledEmbedding, SearchKey};

/// Number of dimensions produced by [`EMBEDDING_MODEL`].
pub const DIMS: usize = 1536;

/// The OpenAI model used to produce embeddings.
pub const EMBEDDING_MODEL: &str = "text-embedding-3-small";

/// An [`EmbeddingModel`] that calls OpenAI's embeddings API.
pub struct TextEmbedding3Small {
    client: Client<OpenAIConfig>,
}

impl TextEmbedding3Small {
    /// Creates an embedder authenticated with `api_key`.
    ///
    /// The key is used directly — nothing is read from the environment.
    pub fn new(api_key: impl Into<String>) -> Self {
        let config = OpenAIConfig::new().with_api_key(api_key);
        Self {
            client: Client::with_config(config),
        }
    }

    /// Creates an embedder from a pre-configured OpenAI client.
    ///
    /// Use this to customize the API base, organization, HTTP client, etc.
    pub fn with_client(client: Client<OpenAIConfig>) -> Self {
        Self { client }
    }
}

impl EmbeddingModel<DIMS> for TextEmbedding3Small {
    async fn embed(
        &self,
        content: &(dyn Embeddable + Sync),
    ) -> anyhow::Result<Vec<LabeledEmbedding<'static, DIMS>>> {
        // Take ownership of the content up front: results are `'static`, and we
        // must not hold a borrow of `content` across the await point.
        let fields: Vec<(SearchKey, String)> = content
            .embedding_content()
            .into_iter()
            .map(|(key, text)| (key, text.into_owned()))
            .collect();

        // OpenAI rejects empty input, so short-circuit when there's nothing to embed.
        if fields.is_empty() {
            return Ok(Vec::new());
        }

        let request = CreateEmbeddingRequestArgs::default()
            .model(EMBEDDING_MODEL)
            .input(EmbeddingInput::StringArray(
                fields.iter().map(|(_, text)| text.clone()).collect(),
            ))
            .dimensions(DIMS as u32)
            .build()?;

        let response = self.client.embeddings().create(request).await?;

        if response.data.len() != fields.len() {
            anyhow::bail!(
                "OpenAI returned {} embeddings for {} inputs",
                response.data.len(),
                fields.len(),
            );
        }

        // Reassemble in input order using each embedding's `index`; the API does
        // not guarantee response ordering.
        let mut vectors: Vec<Option<Vec<f32>>> = (0..fields.len()).map(|_| None).collect();
        for embedding in response.data {
            let index = embedding.index as usize;
            let slot = vectors
                .get_mut(index)
                .with_context(|| format!("OpenAI returned out-of-range index {index}"))?;
            *slot = Some(embedding.embedding);
        }

        fields
            .into_iter()
            .zip(vectors)
            .map(|((search_key, content), vector)| {
                let vector = vector.context("OpenAI omitted an embedding for an input")?;
                let embedding: Embedding<DIMS> = vector.try_into().map_err(|v: Vec<f32>| {
                    anyhow::anyhow!("expected {DIMS} dimensions, got {}", v.len())
                })?;
                Ok(LabeledEmbedding {
                    search_key,
                    content: Cow::Owned(content),
                    embedding,
                })
            })
            .collect()
    }
}
