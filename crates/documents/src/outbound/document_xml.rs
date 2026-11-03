//! Live document XML through the lexical exporter.
use crate::domain::{document_edits::LiveDocumentXmlReader, models::DocumentError};
use lexical_client::LexicalClient;

impl LiveDocumentXmlReader for LexicalClient {
    async fn xml(&self, document_id: &str) -> Result<String, DocumentError> {
        self.get_xml(document_id)
            .await
            .map_err(DocumentError::Internal)
    }
}
