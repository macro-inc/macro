//! Live document Markdown, in the lossless format agents read and write back.
use crate::domain::{models::DocumentError, text::LiveMarkdownReader};
use lexical_client::LexicalClient;

#[cfg(test)]
mod test;

impl LiveMarkdownReader for LexicalClient {
    async fn markdown(&self, document_id: &str) -> Result<String, DocumentError> {
        self.get_agent_markdown(document_id)
            .await
            .map_err(DocumentError::Internal)
    }
}
