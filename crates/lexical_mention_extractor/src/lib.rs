#![deny(missing_docs)]
//! Lexical-service adapter for raw Markdown mentions on every message parent.

use lexical_client::LexicalClient;
use messages::domain::models::SimpleMention;
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

impl messages::domain::ports::MessageMentionExtractor for LexicalMentionExtractor {
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
            self.client
                .extract_mentions(content)
                .await
                .map(|mentions| {
                    mentions
                        .into_iter()
                        .map(|mention| SimpleMention {
                            entity_type: mention.entity_type,
                            entity_id: mention.entity_id,
                        })
                        .collect()
                })
                .map_err(|error| {
                    messages::domain::ports::MessageError::Repository(
                        rootcause::report!(error).into(),
                    )
                })
        })
    }
}
