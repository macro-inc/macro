//! Live document Markdown through the existing lexical exporter.
use crate::domain::{models::DocumentError, text::LiveMarkdownReader};
use lexical_client::{LexicalClient, parse_markdown::MarkdownTarget};

#[cfg(test)]
mod test;

impl LiveMarkdownReader for LexicalClient {
    async fn markdown(&self, document_id: &str) -> Result<String, DocumentError> {
        self.get_markdown(document_id, MarkdownTarget::External)
            .await
            .map_err(DocumentError::Internal)
    }
}
