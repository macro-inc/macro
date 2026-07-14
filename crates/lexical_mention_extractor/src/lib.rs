#![deny(missing_docs)]
//! Lexical-service adapter for extracting the mentions embedded in channel
//! message content, implementing the `channels` domain's
//! [`ChannelMentionExtractor`] port.

use channels::domain::models::SimpleMention;
use channels::domain::ports::ChannelMentionExtractor;
use lexical_client::LexicalClient;
use std::sync::Arc;

/// Mention extractor backed by the lexical service `/mentions` endpoint.
#[derive(Clone)]
pub struct LexicalMentionExtractor {
    client: Arc<LexicalClient>,
}

impl LexicalMentionExtractor {
    /// Create a new extractor backed by `client`.
    pub fn new(client: Arc<LexicalClient>) -> Self {
        Self { client }
    }
}

impl ChannelMentionExtractor for LexicalMentionExtractor {
    type Err = anyhow::Error;

    async fn extract_mentions(&self, content: &str) -> Result<Vec<SimpleMention>, Self::Err> {
        Ok(self
            .client
            .extract_mentions(content)
            .await?
            .into_iter()
            .map(|mention| SimpleMention {
                entity_type: mention.entity_type,
                entity_id: mention.entity_id,
            })
            .collect())
    }
}
