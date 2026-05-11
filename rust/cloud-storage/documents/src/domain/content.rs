//! Document content lifecycle API shapes and domain policy.

use std::ops::Deref;
use std::str::FromStr;

use model::document::response::DocumentResponseMetadata;
use model::document::{DocumentBasic, DocumentMetadata, FileType};
use model::response::{PresignedUrl, TypedSuccessResponse};
use models_permissions::share_permission::access_level::AccessLevel;

/// Durable content lifecycle state exposed by document APIs.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, Copy)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum DocumentContentState {
    /// The service cannot determine the content lifecycle state from current metadata.
    Unknown,
    /// Metadata exists, but the uploaded bytes are not finalized yet.
    PendingUpload,
    /// Uploaded bytes were accepted and backend processing is in progress.
    Processing,
    /// Content is finalized and should be readable from `location`.
    Ready,
    /// Finalization or processing failed.
    Failed,
}

/// Where document content is, or is expected to be, read from.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, Copy)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
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

    /// Metadata exists, but upload/finalization has not completed.
    pub fn pending_upload() -> Self {
        Self {
            state: DocumentContentState::PendingUpload,
            location: None,
        }
    }

    /// Backend processing is in progress.
    pub fn processing() -> Self {
        Self {
            state: DocumentContentState::Processing,
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

    /// Content finalization failed.
    pub fn failed() -> Self {
        Self {
            state: DocumentContentState::Failed,
            location: None,
        }
    }

    /// Derive the best content metadata available from the legacy
    /// `Document.uploaded` boolean and file type.
    pub fn from_legacy_uploaded(uploaded: bool, file_type: Option<FileType>) -> Self {
        if !uploaded {
            return Self::pending_upload();
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

/// Full document metadata plus content lifecycle metadata.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentMetadataWithContent {
    /// Legacy document metadata.
    #[serde(flatten)]
    pub metadata: DocumentMetadata,
    /// Content lifecycle and location metadata.
    pub content: DocumentContent,
}

impl DocumentMetadataWithContent {
    /// Attach content metadata to legacy document metadata.
    pub fn new(metadata: DocumentMetadata, content: DocumentContent) -> Self {
        Self { metadata, content }
    }
}

impl Deref for DocumentMetadataWithContent {
    type Target = DocumentMetadata;

    fn deref(&self) -> &Self::Target {
        &self.metadata
    }
}

/// Create/copy response metadata plus content lifecycle metadata.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentResponseMetadataWithContent {
    /// Legacy create/copy response metadata.
    #[serde(flatten)]
    pub metadata: DocumentResponseMetadata,
    /// Content lifecycle and location metadata.
    pub content: DocumentContent,
}

impl DocumentResponseMetadataWithContent {
    /// Attach content metadata to legacy response metadata.
    pub fn new(metadata: DocumentResponseMetadata, content: DocumentContent) -> Self {
        Self { metadata, content }
    }
}

impl Deref for DocumentResponseMetadataWithContent {
    type Target = DocumentResponseMetadata;

    fn deref(&self) -> &Self::Target {
        &self.metadata
    }
}

/// Document response with content lifecycle metadata.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentResponse {
    /// The document metadata.
    pub document_metadata: DocumentResponseMetadataWithContent,
    /// Presigned upload URL, when the caller still needs to upload bytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presigned_url: Option<String>,
}

/// Create document response data with content lifecycle metadata.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CreateDocumentResponseData {
    /// Document metadata and upload URL.
    #[serde(flatten)]
    pub document_response: DocumentResponse,
    /// Content type of the document converted from file type.
    pub content_type: String,
    /// The file type of the document.
    pub file_type: Option<String>,
}

impl CreateDocumentResponseData {
    /// Attach content metadata to a legacy create response.
    pub fn from_legacy(
        legacy: model::document::response::CreateDocumentResponseData,
        content: DocumentContent,
    ) -> Self {
        Self {
            document_response: DocumentResponse {
                document_metadata: DocumentResponseMetadataWithContent::new(
                    legacy.document_response.document_metadata,
                    content,
                ),
                presigned_url: legacy.document_response.presigned_url,
            },
            content_type: legacy.content_type,
            file_type: legacy.file_type,
        }
    }
}

/// Create document HTTP response.
pub type CreateDocumentResponse = TypedSuccessResponse<CreateDocumentResponseData>;

/// Get document response data with content lifecycle metadata.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GetDocumentResponseData {
    /// The metadata of the document.
    pub document_metadata: DocumentMetadataWithContent,
    /// The user's level of access to the document.
    pub user_access_level: AccessLevel,
    /// The user's view location if there is one.
    pub view_location: Option<String>,
}

/// Get document HTTP response.
pub type GetDocumentResponse = TypedSuccessResponse<GetDocumentResponseData>;

/// Location response with content lifecycle metadata.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum LocationResponseV3 {
    /// A single document-storage URL.
    PresignedUrl {
        /// Presigned URL.
        presigned_url: String,
        /// Basic document metadata.
        metadata: DocumentBasic,
        /// Content lifecycle and location metadata.
        content: DocumentContent,
    },
    /// Multiple document-storage URLs, currently for DOCX BOM parts.
    PresignedUrls {
        /// Presigned URLs.
        presigned_urls: Vec<PresignedUrl>,
        /// Basic document metadata.
        metadata: DocumentBasic,
        /// Content lifecycle and location metadata.
        content: DocumentContent,
    },
    /// Sync-service backed content.
    SyncServiceContent {
        /// Basic document metadata.
        metadata: DocumentBasic,
        /// Sync-service metadata.
        sync_service_metadata: model::sync_service::DocumentMetadata,
        /// Content lifecycle and location metadata.
        content: DocumentContent,
    },
}

impl LocationResponseV3 {
    /// Basic document metadata for the location response.
    pub fn metadata(&self) -> &DocumentBasic {
        match self {
            Self::PresignedUrl { metadata, .. } => metadata,
            Self::PresignedUrls { metadata, .. } => metadata,
            Self::SyncServiceContent { metadata, .. } => metadata,
        }
    }

    /// Content lifecycle metadata for the location response.
    pub fn content(&self) -> &DocumentContent {
        match self {
            Self::PresignedUrl { content, .. } => content,
            Self::PresignedUrls { content, .. } => content,
            Self::SyncServiceContent { content, .. } => content,
        }
    }

    /// Sync-service metadata, when this location is sync-backed.
    pub fn sync_service_metadata(&self) -> Option<&model::sync_service::DocumentMetadata> {
        if let Self::SyncServiceContent {
            sync_service_metadata,
            ..
        } = self
        {
            Some(sync_service_metadata)
        } else {
            None
        }
    }

    /// Parsed file type from metadata.
    pub fn file_type(&self) -> anyhow::Result<FileType> {
        self.metadata()
            .file_type
            .as_deref()
            .map(FileType::from_str)
            .and_then(Result::ok)
            .ok_or_else(|| anyhow::anyhow!("unexpected file type {:?}", self.metadata().file_type))
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
                state: DocumentContentState::PendingUpload,
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
