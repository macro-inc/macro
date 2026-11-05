#![deny(missing_docs)]
//! Lexical-service adapters for reading raw message content, implementing
//! the `messages` domain's [`MessageMentionExtractor`] and
//! [`MessageLinkExtractor`] ports.

use lexical_client::LexicalClient;
use messages::domain::{
    models::SimpleMention,
    ports::{MessageError, MessageLinkExtractor, MessageMentionExtractor},
};
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

/// Link extractor backed by the lexical service `/link-previews` endpoint, so
/// the server picks the links a rendered message shows cards for.
#[derive(Clone)]
pub struct LexicalLinkExtractor {
    client: Arc<LexicalClient>,
}

impl LexicalLinkExtractor {
    /// Create a new extractor backed by `client`.
    pub fn new(client: Arc<LexicalClient>) -> Self {
        Self { client }
    }
}

impl MessageLinkExtractor for LexicalLinkExtractor {
    fn extract<'a>(
        &'a self,
        content: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<Vec<String>, MessageError>> + Send + 'a>>
    {
        Box::pin(async move {
            self.client
                .extract_link_preview_urls(content)
                .await
                .map_err(|error| MessageError::Repository(rootcause::report!(error).into()))
        })
    }
}
