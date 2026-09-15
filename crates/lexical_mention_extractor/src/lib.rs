#![deny(missing_docs)]
//! Lexical-service adapter for extracting the mentions embedded in raw
//! message content, implementing the `channels` domain's
//! [`ChannelMentionExtractor`] port and the `messages` domain's
//! [`MessageMentionExtractor`] port.

use channels::domain::ports::ChannelMentionExtractor;
use lexical_client::LexicalClient;
use messages::domain::{models::SimpleMention, ports::MessageMentionExtractor};
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

    async fn mentions(&self, content: &str) -> anyhow::Result<Vec<SimpleMention>> {
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

impl ChannelMentionExtractor for LexicalMentionExtractor {
    type Err = anyhow::Error;

    async fn extract_mentions(&self, content: &str) -> Result<Vec<SimpleMention>, Self::Err> {
        self.mentions(content).await
    }
}

impl MessageMentionExtractor for LexicalMentionExtractor {
    fn extract<'a>(
        &'a self,
        content: &'a str,
    ) -> std::pin::Pin<
        Box<
            dyn Future<Output = Result<Vec<SimpleMention>, messages::domain::ports::MessageError>>
                + Send
                + 'a,
        >,
    > {
        Box::pin(async move {
            self.mentions(content).await.map_err(|error| {
                messages::domain::ports::MessageError::Repository(rootcause::report!(error).into())
            })
        })
    }
}
