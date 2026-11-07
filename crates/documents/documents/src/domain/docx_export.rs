//! Export an uploaded Word document only after its extracted parts are ready.

use entity_access::domain::models::{EntityAccessReceipt, EntityType, ViewAccessLevel};
use model::document::BomPart;
use std::future::Future;

use super::models::DocumentError;

/// Persistence capabilities for exporting an uploaded DOCX.
#[cfg_attr(test, mockall::automock(type Err = std::io::Error;))]
pub trait DocxExportStore: Send + Sync {
    /// The adapter's persistence error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Read the latest version's parts from the primary database. The unzip
    /// worker inserts these atomically after their objects have been stored.
    fn parts(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<Vec<BomPart>, Self::Err>> + Send;

    /// Export this exact set of parts and return its signed download URL.
    /// Cache identity must include the parts, so incomplete legacy exports
    /// and exports of earlier versions cannot be reused.
    fn export_parts(
        &self,
        document_id: &str,
        parts: Vec<BomPart>,
    ) -> impl Future<Output = Result<String, Self::Err>> + Send;
}

/// An export may be requested while the upload is still being extracted.
#[derive(Debug, PartialEq, Eq)]
pub enum DocxExport {
    /// The version exists, but the worker has not saved its parts yet.
    Processing,
    /// A signed URL for a complete export.
    Ready(String),
}

/// Readiness is determined by the parts, independently of PDF conversion or
/// the legacy `uploaded` flag. Never cache the absence of parts as an empty ZIP.
#[tracing::instrument(skip_all, fields(document_id = %access.entity().entity_id, part_count), err)]
pub async fn export_docx(
    store: &impl DocxExportStore,
    access: EntityAccessReceipt<ViewAccessLevel>,
) -> Result<DocxExport, DocumentError> {
    if access.entity().entity_type != EntityType::Document {
        return Err(DocumentError::Unauthorized);
    }
    let document_id = &access.entity().entity_id;
    let parts = store
        .parts(document_id)
        .await
        .map_err(|error| DocumentError::Internal(error.into()))?;
    tracing::Span::current().record("part_count", parts.len());
    if parts.is_empty() {
        tracing::info!("DOCX export waiting for upload extraction");
        return Ok(DocxExport::Processing);
    }
    Ok(DocxExport::Ready(
        store
            .export_parts(document_id, parts)
            .await
            .map_err(|error| DocumentError::Internal(error.into()))?,
    ))
}

#[cfg(test)]
mod test;
