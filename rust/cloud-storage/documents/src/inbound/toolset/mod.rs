//! Toolset inbound adapter for Documents.

mod read_content;
mod read_metadata;

#[cfg(test)]
mod test;

use crate::{
    domain::ports::DocumentService,
    inbound::toolset::{read_content::ReadContent, read_metadata::ReadMetadata},
};
use ai::tool::AsyncToolSet;
use entity_access::domain::ports::EntityAccessService;
use lexical_client::LexicalClient;
use std::sync::Arc;

/// Service context for document AI tools
pub struct DocumentToolContext<DSvc: DocumentService, ESvc: EntityAccessService> {
    /// The document service instance
    pub service: Arc<DSvc>,
    /// The entity access service instance
    pub entity_access_service: Arc<ESvc>,

    /// The lexical client
    pub lexical_client: Arc<LexicalClient>,
}

impl<DSvc: DocumentService, ESvc: EntityAccessService> Clone for DocumentToolContext<DSvc, ESvc> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            lexical_client: self.lexical_client.clone(),
        }
    }
}

impl<DSvc: DocumentService, ESvc: EntityAccessService> DocumentToolContext<DSvc, ESvc> {
    /// Create a new document tool context
    pub fn new(service: DSvc, entity_access_service: ESvc, lexical_client: LexicalClient) -> Self {
        Self {
            service: Arc::new(service),
            entity_access_service: Arc::new(entity_access_service),
            lexical_client: Arc::new(lexical_client),
        }
    }
}

/// Create a document toolset
pub fn document_toolset<DSvc, ESvc>() -> AsyncToolSet<DocumentToolContext<DSvc, ESvc>>
where
    DSvc: DocumentService,
    ESvc: EntityAccessService,
{
    AsyncToolSet::new()
        .add_tool::<ReadMetadata, DocumentToolContext<DSvc, ESvc>>()
        .expect("failed to add ReadMetadata tool")
        .add_tool::<ReadContent, DocumentToolContext<DSvc, ESvc>>()
        .expect("failed to add ReadContent tool")
}
