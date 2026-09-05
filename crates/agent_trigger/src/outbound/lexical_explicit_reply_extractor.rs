//! Explicit-reply extraction backed by the lexical service.

use agent_session::domain::error::Result;
use lexical_client::LexicalClient;

use crate::domain::service::{ExplicitReplyExtractor, ExtractedExplicitReply};

/// Extracts explicit replies by parsing the markdown with the lexical service,
/// so the reply-target matches the `ReplyTargetNode` the editor itself produces.
pub struct LexicalExplicitReplyExtractor {
    client: LexicalClient,
}

impl LexicalExplicitReplyExtractor {
    /// Creates an extractor calling the given lexical service client.
    pub const fn new(client: LexicalClient) -> Self {
        Self { client }
    }
}

impl ExplicitReplyExtractor for LexicalExplicitReplyExtractor {
    async fn extract_explicit_reply(
        &self,
        markdown: &str,
    ) -> Result<Option<ExtractedExplicitReply>> {
        Ok(self
            .client
            .extract_explicit_reply(markdown)
            .await?
            .map(|reply| ExtractedExplicitReply {
                channel_id: reply.channel_id,
                target_message_id: reply.target_message_id,
                target_thread_id: reply.target_thread_id,
                display_text: reply.display_text,
                sender_id: reply.sender_id,
            }))
    }
}
