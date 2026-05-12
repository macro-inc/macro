//! Document API response shapes owned by the documents domain.

use std::str::FromStr;

use model::document::response::DocumentResponseMetadata;
use model::document::{DocumentBasic, DocumentMetadata, FileType};
use model::response::{PresignedUrl, TypedSuccessResponse};
use models_permissions::share_permission::access_level::AccessLevel;

use super::content::DocumentContent;

/// Peer/user mapping returned by sync-service metadata.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub struct SyncServicePeerWithUserId {
    /// Sync-service peer id.
    pub peer_id: String,
    /// Macro user id.
    pub user_id: String,
}

impl From<model::sync_service::PeerWithUserId> for SyncServicePeerWithUserId {
    fn from(peer: model::sync_service::PeerWithUserId) -> Self {
        Self {
            peer_id: peer.peer_id,
            user_id: peer.user_id,
        }
    }
}

/// Sync-service document metadata exposed through document location responses.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub struct SyncServiceDocumentMetadata {
    /// Sync-service document id.
    pub id: String,
    /// Known peers for the sync document.
    pub peers: Vec<SyncServicePeerWithUserId>,
    /// Current sync-service version id.
    pub version_id: String,
}

impl From<model::sync_service::DocumentMetadata> for SyncServiceDocumentMetadata {
    fn from(metadata: model::sync_service::DocumentMetadata) -> Self {
        Self {
            id: metadata.id,
            peers: metadata.peers.into_iter().map(Into::into).collect(),
            version_id: metadata.version_id,
        }
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
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LocationResponseV3 {
    /// A single document-storage URL.
    PresignedUrl {
        /// Presigned URL.
        #[serde(rename = "presignedUrl")]
        #[cfg_attr(feature = "axum", schema(rename = "presignedUrl"))]
        presigned_url: String,
        /// Basic document metadata.
        metadata: DocumentBasic,
        /// Content lifecycle and location metadata.
        content: DocumentContent,
    },
    /// Multiple document-storage URLs, currently for DOCX BOM parts.
    PresignedUrls {
        /// Presigned URLs.
        #[serde(rename = "presignedUrls")]
        #[cfg_attr(feature = "axum", schema(rename = "presignedUrls"))]
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
        #[serde(rename = "syncServiceMetadata")]
        #[cfg_attr(feature = "axum", schema(rename = "syncServiceMetadata"))]
        sync_service_metadata: SyncServiceDocumentMetadata,
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
    pub fn sync_service_metadata(&self) -> Option<&SyncServiceDocumentMetadata> {
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
