//! Text read policy for live Markdown and extracted file content.
use super::{models::DocumentError, ports::DocumentService};
use entity_access::domain::models::{EntityAccessReceipt, EntityType, ViewAccessLevel};
use model::document::DocumentBasic;
use std::future::Future;

#[cfg(test)]
mod test;

/// Live Markdown export from collaborative storage.
pub trait LiveMarkdownReader: Send + Sync {
    /// Export the current document as ordinary Markdown, including recent edits.
    fn markdown(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<String, DocumentError>> + Send;
}

/// Text representation when the document supports one. Other file formats
/// retain their existing download/export behavior.
#[derive(serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct DocumentTextContent {
    /// Current Markdown, or extracted PDF/Word text. Null means use file export.
    #[cfg_attr(feature = "axum", schema(required))]
    pub text: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum TextSource {
    Markdown,
    Extracted,
    Export,
}

fn source(
    access: &EntityAccessReceipt<ViewAccessLevel>,
    document: &DocumentBasic,
) -> Result<TextSource, DocumentError> {
    if access.entity().entity_type != EntityType::Document
        || access.entity().entity_id != document.document_id
    {
        return Err(DocumentError::Unauthorized);
    }
    Ok(match document.file_type.as_deref() {
        Some("md") => TextSource::Markdown,
        Some("pdf" | "docx") => TextSource::Extracted,
        _ => TextSource::Export,
    })
}

/// Read authorized document text through the owning document capabilities.
/// Native Markdown never falls back to a potentially stale legacy S3 object.
pub async fn read_text<D: DocumentService, M: LiveMarkdownReader>(
    documents: &D,
    markdown: &M,
    access: EntityAccessReceipt<ViewAccessLevel>,
    document: &DocumentBasic,
) -> Result<DocumentTextContent, DocumentError> {
    let text = match source(&access, document)? {
        TextSource::Markdown => Some(markdown.markdown(&document.document_id).await?),
        TextSource::Extracted => Some(documents.get_document_text(access).await?),
        TextSource::Export => None,
    };
    Ok(DocumentTextContent { text })
}
