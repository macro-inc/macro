//! Quote-reply detection backed by the lexical service.

use agent_session::domain::error::Result;
use lexical_client::LexicalClient;

use crate::domain::service::ReplyDetector;

/// Detects quote-replies by parsing the markdown with the lexical service,
/// so detection matches the nodes the editor itself produces.
pub struct LexicalReplyDetector {
    client: LexicalClient,
}

impl LexicalReplyDetector {
    /// Creates a detector calling the given lexical service client.
    pub const fn new(client: LexicalClient) -> Self {
        Self { client }
    }
}

impl ReplyDetector for LexicalReplyDetector {
    async fn is_quote_reply(&self, markdown: &str) -> Result<bool> {
        Ok(self.client.is_quote_reply(markdown).await?)
    }
}
