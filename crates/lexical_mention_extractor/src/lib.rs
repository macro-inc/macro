#![deny(missing_docs)]
//! Lexical-service adapter for extracting the mentions embedded in raw
//! message content, implementing the `messages` domain's
//! [`MessageMentionExtractor`] port.

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

#[cfg(test)]
mod test {
    use super::*;
    use lexical_client::test_utils::FakeLexical;

    #[tokio::test]
    async fn message_mentions_use_the_selected_route_in_every_mode() {
        let markdown = r#"<m-document-mention>{"blockName":"channel","documentId":"reference","documentName":"Name"}</m-document-mention>"#;
        for mode in ["http", "in_process", "shadow"] {
            let backend = FakeLexical::new("", vec![("POST", "/mentions", serde_json::json!({"mentions":[{"entityType":"channel","entityId":"reference"}]}))]).await;
            let extractor =
                LexicalMentionExtractor::new(Arc::new(backend.client(&format!("snapshot={mode}"))));
            let mentions = extractor.extract(markdown).await.unwrap();
            assert_eq!(mentions.len(), 1);
            assert_eq!(mentions[0].entity_type, "channel");
            assert_eq!(mentions[0].entity_id, "reference");
            let requests = backend.requests();
            assert_eq!(requests.len(), usize::from(mode != "in_process"));
            if let Some(request) = requests.first() {
                assert_eq!(request.body, serde_json::json!({"markdown":markdown}));
            }
            assert_eq!(backend.raw_reads(), 0);
        }
    }
}
