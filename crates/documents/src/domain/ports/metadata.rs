//! Receipt-gated document metadata reads for explicitly addressed documents.

use std::future::Future;

use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};

use crate::domain::models::{DocumentError, ViewedDocumentMetadata};

/// Reads document metadata without using discovery eligibility or loading content.
pub trait DocumentMetadataService: Send + Sync + 'static {
    /// Read a live document for the authenticated viewer named by the receipt.
    fn viewed_metadata(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Option<ViewedDocumentMetadata>, DocumentError>> + Send;
}

/// Read task status through the owning properties service.
pub trait TaskStatusPort: Send + Sync + 'static {
    /// Return status option IDs for the document named by the view receipt.
    fn task_status(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Option<Vec<uuid::Uuid>>, DocumentError>> + Send;
}
