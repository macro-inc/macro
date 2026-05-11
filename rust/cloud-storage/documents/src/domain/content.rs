//! Document content lifecycle API shapes and domain policy.

use std::str::FromStr;

use model::document::FileType;

/// API-visible content lifecycle state derived from current document metadata.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, Copy)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum DocumentContentState {
    /// The service cannot determine the content lifecycle state from current metadata.
    Unknown,
    /// Metadata exists, but canonical content is not ready to consume yet.
    Pending,
    /// Content is finalized and should be readable from `location`.
    Ready,
}

/// Where document content is, or is expected to be, read from.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, Copy)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum DocumentContentLocation {
    /// Content is stored as a document-storage object.
    ObjectStorage,
    /// Content is stored in sync-service.
    SyncService,
    /// DOCX content is stored as document-storage BOM parts.
    DocxBomParts,
    /// DOCX content is exposed through a converted PDF object in document storage.
    ConvertedPdf,
    /// Legacy metadata says content is uploaded, but not where the canonical
    /// finalized content lives.
    Unknown,
}

/// API-visible content lifecycle and location metadata.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentContent {
    /// The current lifecycle state of the content.
    pub state: DocumentContentState,
    /// The content location, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<DocumentContentLocation>,
}

impl Default for DocumentContent {
    fn default() -> Self {
        Self::unknown()
    }
}

impl DocumentContent {
    /// The content state/location cannot be determined from current metadata.
    pub fn unknown() -> Self {
        Self {
            state: DocumentContentState::Unknown,
            location: None,
        }
    }

    /// Metadata exists, but canonical content is not ready to consume yet.
    pub fn pending() -> Self {
        Self {
            state: DocumentContentState::Pending,
            location: None,
        }
    }

    /// Content is finalized at a known location.
    pub fn ready(location: DocumentContentLocation) -> Self {
        Self {
            state: DocumentContentState::Ready,
            location: Some(location),
        }
    }

    /// Derive the best content metadata available from the legacy
    /// `Document.uploaded` boolean and file type.
    pub fn from_legacy_uploaded(uploaded: bool, file_type: Option<FileType>) -> Self {
        if !uploaded {
            return Self::pending();
        }

        let location = match file_type {
            Some(FileType::Docx) => DocumentContentLocation::DocxBomParts,
            // Historical markdown documents may be in sync-service, S3, or both.
            // A backfill can replace this legacy ambiguity with SyncService.
            Some(FileType::Md) => DocumentContentLocation::Unknown,
            _ => DocumentContentLocation::ObjectStorage,
        };

        Self::ready(location)
    }

    /// Derive content metadata from legacy DB columns where file type is stored
    /// as a string extension.
    pub fn from_legacy_uploaded_str(uploaded: bool, file_type: Option<&str>) -> Self {
        Self::from_legacy_uploaded(
            uploaded,
            file_type.and_then(|file_type| FileType::from_str(file_type).ok()),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{DocumentContent, DocumentContentLocation, DocumentContentState};
    use model::document::FileType;

    #[test]
    fn legacy_not_uploaded_is_pending() {
        assert_eq!(
            DocumentContent::from_legacy_uploaded(false, Some(FileType::Pdf)),
            DocumentContent {
                state: DocumentContentState::Pending,
                location: None,
            }
        );
    }

    #[test]
    fn legacy_uploaded_markdown_location_is_unknown() {
        assert_eq!(
            DocumentContent::from_legacy_uploaded(true, Some(FileType::Md)),
            DocumentContent::ready(DocumentContentLocation::Unknown)
        );
    }

    #[test]
    fn legacy_uploaded_non_markdown_uses_object_storage() {
        assert_eq!(
            DocumentContent::from_legacy_uploaded(true, Some(FileType::Pdf)),
            DocumentContent::ready(DocumentContentLocation::ObjectStorage)
        );
    }
}
