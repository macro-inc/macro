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

/// Maximum characters of any single input sent to the embeddings API.
///
/// `text-embedding-3-small` rejects inputs longer than 8192 tokens, and real
/// task bodies occasionally carry a huge pasted dump; without a cap the whole
/// embed call — and therefore duplicate detection for that task — fails. We cap
/// by characters (rather than pulling in a tokenizer): for the largely
/// Latin-script text we embed this stays well under the token limit, and a
/// task's dedup signal lives in its opening prose, so keeping the leading
/// characters loses nothing that matters.
const MAX_INPUT_CHARS: usize = 8000;

/// Truncates `text` to at most [`MAX_INPUT_CHARS`] characters, on a character
/// boundary, returning it unchanged when it already fits.
fn truncate_for_embedding(text: &str) -> Cow<'_, str> {
    if text.chars().count() <= MAX_INPUT_CHARS {
        Cow::Borrowed(text)
    } else {
        Cow::Owned(text.chars().take(MAX_INPUT_CHARS).collect())
    }
}

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
        // Cap each field to the embeddings API's input limit. The truncated text
        // is used both as the request input and as the stored `content`, so the
        // persisted text always matches what was actually embedded.
        let fields: Vec<(SearchKey, String)> = content
            .embedding_content()
            .into_iter()
            .map(|(key, text)| (key, truncate_for_embedding(text.as_ref()).into_owned()))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_short_input_borrowed() {
        assert!(matches!(
            truncate_for_embedding("short task body"),
            Cow::Borrowed(_)
        ));
    }

    #[test]
    fn truncates_long_input_to_char_cap() {
        let long = "a".repeat(MAX_INPUT_CHARS + 500);
        let truncated = truncate_for_embedding(&long);
        assert_eq!(truncated.chars().count(), MAX_INPUT_CHARS);
    }

    #[test]
    fn truncates_multibyte_input_on_char_boundary() {
        // Emoji are 4 bytes each: a naive byte cut would panic / corrupt UTF-8.
        let long = "🎉".repeat(MAX_INPUT_CHARS + 10);
        let truncated = truncate_for_embedding(&long);
        assert_eq!(truncated.chars().count(), MAX_INPUT_CHARS);
        assert!(truncated.chars().all(|c| c == '🎉'));
    }
}
