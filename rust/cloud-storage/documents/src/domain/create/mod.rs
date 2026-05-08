//! Document creation orchestration.
//!
//! This module keeps backend-owned document creation policy in one place. It
//! intentionally exposes explicit creation methods rather than a generic
//! document-kind dispatcher: call sites should choose the lifecycle they need
//! (`create_markdown_text`, `create_text_file`, or `MarkdownInitializer` for
//! already-created uploads).

use anyhow::Context;
use base64::Engine;
use lexical_client::LexicalClient;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;
use model::document::response::CreateDocumentResponseData;
use sha2::{Digest, Sha256};
use sync_service_client::SyncServiceClient;

use crate::domain::models::{
    CreateDocumentRepoArgs, CreateTaskRequest, DocumentError, EMPTY_SHA256, PropertyInput,
};
use crate::domain::ports::DocumentService;

/// Common metadata for a document that has not been created yet.
#[derive(Debug, Clone)]
pub struct NewDocumentMetadata {
    /// Optional caller-provided document id.
    pub id: Option<uuid::Uuid>,
    /// Document name without extension.
    pub document_name: String,
    /// Project to associate the document with.
    pub project_id: Option<uuid::Uuid>,
    /// Email attachment to link for internal attachment flows.
    pub email_attachment_id: Option<uuid::Uuid>,
    /// Custom creation timestamp.
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Whether to skip adding the document to user history.
    pub skip_history: bool,
}

impl NewDocumentMetadata {
    fn into_repo_args(
        self,
        user_id: MacroUserIdStr<'static>,
        kind: RepoDocumentKind,
    ) -> CreateDocumentRepoArgs {
        CreateDocumentRepoArgs {
            id: self.id,
            sha: kind.sha,
            document_name: self.document_name,
            user_id,
            file_type: kind.file_type,
            project_id: self.project_id,
            email_attachment_id: self.email_attachment_id,
            created_at: self.created_at,
            is_task: kind.subtype.is_task(),
            skip_history: self.skip_history,
        }
    }
}

struct RepoDocumentKind {
    file_type: Option<FileType>,
    sha: String,
    subtype: RepoDocumentSubtype,
}

enum RepoDocumentSubtype {
    Regular,
    MarkdownTask,
}

impl RepoDocumentSubtype {
    fn is_task(&self) -> bool {
        matches!(self, RepoDocumentSubtype::MarkdownTask)
    }
}

/// Markdown-specific subtype. Task-ness only exists for markdown documents.
#[derive(Debug, Clone)]
pub enum MarkdownSubtype {
    /// A regular markdown note.
    Note,
    /// A task document.
    Task {
        /// Optional property values to assign. Defaults are used when omitted.
        property_values: Option<Vec<PropertyInput>>,
        /// Whether to share the task with the user's team.
        share_with_team: bool,
    },
}

impl MarkdownSubtype {
    /// Convert a simple task flag into the default markdown subtype.
    pub fn from_task_flag(is_task: bool) -> Self {
        if is_task {
            Self::Task {
                property_values: None,
                share_with_team: true,
            }
        } else {
            Self::Note
        }
    }
}

/// A backend-created markdown document.
///
/// Creation writes document metadata, initializes sync-service from `markdown`,
/// and applies task properties when `subtype` is [`MarkdownSubtype::Task`].
#[derive(Debug, Clone)]
pub struct NewMarkdownTextDocument {
    /// Common document metadata.
    pub metadata: NewDocumentMetadata,
    /// Markdown source text.
    pub markdown: String,
    /// Markdown subtype.
    pub subtype: MarkdownSubtype,
}

impl NewMarkdownTextDocument {
    /// Construct an empty markdown note.
    pub fn empty_note(metadata: NewDocumentMetadata) -> Self {
        Self {
            metadata,
            markdown: String::new(),
            subtype: MarkdownSubtype::Note,
        }
    }
}

/// A backend-created plaintext document whose file type determines the
/// creation lifecycle.
#[derive(Debug, Clone)]
pub struct NewPlainTextDocument {
    metadata: NewDocumentMetadata,
    text: String,
    kind: PlainTextDocumentKind,
}

#[derive(Debug, Clone)]
enum PlainTextDocumentKind {
    Markdown(MarkdownSubtype),
    Text(NonMarkdownFileType),
}

impl NewPlainTextDocument {
    /// Construct a plaintext document from a file type, rejecting impossible
    /// combinations like task documents with non-markdown file types.
    pub fn new(
        metadata: NewDocumentMetadata,
        file_type: FileType,
        text: String,
        markdown_subtype: MarkdownSubtype,
    ) -> Result<Self, DocumentError> {
        let kind = if file_type == FileType::Md {
            PlainTextDocumentKind::Markdown(markdown_subtype)
        } else {
            if matches!(markdown_subtype, MarkdownSubtype::Task { .. }) {
                return Err(DocumentError::BadRequest(
                    "tasks must be markdown documents".to_string(),
                ));
            }
            PlainTextDocumentKind::Text(NonMarkdownFileType::new(file_type)?)
        };

        Ok(Self {
            metadata,
            text,
            kind,
        })
    }
}

/// A file type that is known not to be markdown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NonMarkdownFileType(FileType);

impl NonMarkdownFileType {
    /// Create a non-markdown file type, rejecting [`FileType::Md`].
    pub fn new(file_type: FileType) -> Result<Self, DocumentError> {
        if file_type == FileType::Md {
            return Err(DocumentError::BadRequest(
                "md documents must use NewMarkdownTextDocument".to_string(),
            ));
        }

        Ok(Self(file_type))
    }

    /// Get the underlying file type.
    pub fn as_file_type(&self) -> FileType {
        self.0
    }

    fn into_file_type(self) -> FileType {
        self.0
    }
}

impl TryFrom<FileType> for NonMarkdownFileType {
    type Error = DocumentError;

    fn try_from(file_type: FileType) -> Result<Self, Self::Error> {
        Self::new(file_type)
    }
}

/// A backend-created non-markdown text file.
///
/// Creation writes document metadata and uploads `text` to the presigned
/// document-storage URL returned by the document service.
#[derive(Debug, Clone)]
pub struct NewTextFileDocument {
    /// Common document metadata.
    pub metadata: NewDocumentMetadata,
    /// Text document file type. Markdown is excluded by construction.
    pub file_type: NonMarkdownFileType,
    /// Text content to upload.
    pub text: String,
}

impl NewTextFileDocument {
    /// Construct a text file document, rejecting markdown file types.
    pub fn new(
        metadata: NewDocumentMetadata,
        file_type: FileType,
        text: String,
    ) -> Result<Self, DocumentError> {
        Ok(Self {
            metadata,
            file_type: NonMarkdownFileType::new(file_type)?,
            text,
        })
    }
}

/// A fully created document.
#[derive(Debug)]
pub struct CreatedDocument {
    response: CreateDocumentResponseData,
}

impl CreatedDocument {
    fn new(response: CreateDocumentResponseData) -> Self {
        Self { response }
    }

    /// The created document id.
    pub fn document_id(&self) -> &str {
        &self
            .response
            .document_response
            .document_metadata
            .document_id
    }

    /// Get the underlying create response.
    pub fn response(&self) -> &CreateDocumentResponseData {
        &self.response
    }

    /// Consume into the raw create response.
    pub fn into_response(self) -> CreateDocumentResponseData {
        self.response
    }
}

/// Dependencies required for markdown initialization.
pub struct MarkdownInitializer<'a> {
    lexical_client: &'a LexicalClient,
    sync_service_client: &'a SyncServiceClient,
}

impl<'a> MarkdownInitializer<'a> {
    /// Construct a markdown initializer.
    pub fn new(
        lexical_client: &'a LexicalClient,
        sync_service_client: &'a SyncServiceClient,
    ) -> Self {
        Self {
            lexical_client,
            sync_service_client,
        }
    }

    /// Initialize an already-created markdown document from markdown text.
    ///
    /// This is used by flows where metadata was created elsewhere, such as
    /// finalized browser uploads and bulk folder upload. It is still
    /// centralized here so callers do not know about lexical-service or
    /// sync-service wiring.
    #[tracing::instrument(skip(self, markdown), err)]
    pub async fn initialize_existing_markdown(
        &self,
        document_id: &str,
        markdown: &str,
    ) -> Result<(), DocumentError> {
        crate::domain::markdown_init::initialize_markdown_document(
            self.lexical_client,
            self.sync_service_client,
            document_id,
            markdown,
        )
        .await
        .map_err(DocumentError::Internal)
    }
}

/// Service for creating backend-owned document content.
pub struct DocumentCreator<'a, Svc: DocumentService> {
    document_service: &'a Svc,
    lexical_client: &'a LexicalClient,
    sync_service_client: &'a SyncServiceClient,
    http_client: reqwest::Client,
}

impl<'a, Svc: DocumentService> DocumentCreator<'a, Svc> {
    /// Construct a document creator.
    pub fn new(
        document_service: &'a Svc,
        lexical_client: &'a LexicalClient,
        sync_service_client: &'a SyncServiceClient,
    ) -> Self {
        Self::with_http_client(
            document_service,
            lexical_client,
            sync_service_client,
            reqwest::Client::new(),
        )
    }

    /// Construct a document creator with an existing HTTP client.
    pub fn with_http_client(
        document_service: &'a Svc,
        lexical_client: &'a LexicalClient,
        sync_service_client: &'a SyncServiceClient,
        http_client: reqwest::Client,
    ) -> Self {
        Self {
            document_service,
            lexical_client,
            sync_service_client,
            http_client,
        }
    }

    /// Create a plaintext document using the lifecycle implied by its file type.
    #[tracing::instrument(skip(self, document), err)]
    pub async fn create_plain_text(
        &self,
        user_id: MacroUserIdStr<'static>,
        document: NewPlainTextDocument,
    ) -> Result<CreatedDocument, DocumentError> {
        let NewPlainTextDocument {
            metadata,
            text,
            kind,
        } = document;

        match kind {
            PlainTextDocumentKind::Markdown(subtype) => {
                self.create_markdown_text(
                    user_id,
                    NewMarkdownTextDocument {
                        metadata,
                        markdown: text,
                        subtype,
                    },
                )
                .await
            }
            PlainTextDocumentKind::Text(file_type) => {
                self.create_text_file(
                    user_id,
                    NewTextFileDocument {
                        metadata,
                        file_type,
                        text,
                    },
                )
                .await
            }
        }
    }

    /// Create a markdown text document and initialize sync-service.
    #[tracing::instrument(skip(self, document), err)]
    pub async fn create_markdown_text(
        &self,
        user_id: MacroUserIdStr<'static>,
        document: NewMarkdownTextDocument,
    ) -> Result<CreatedDocument, DocumentError> {
        let NewMarkdownTextDocument {
            metadata,
            markdown,
            subtype,
        } = document;
        let task = match &subtype {
            MarkdownSubtype::Note => None,
            MarkdownSubtype::Task {
                property_values,
                share_with_team,
            } => Some((property_values.clone(), *share_with_team)),
        };

        let task_name = metadata.document_name.clone();
        let project_id = metadata.project_id;
        let args = metadata.into_repo_args(
            user_id.clone(),
            RepoDocumentKind {
                file_type: Some(FileType::Md),
                sha: EMPTY_SHA256.to_string(),
                subtype: if task.is_some() {
                    RepoDocumentSubtype::MarkdownTask
                } else {
                    RepoDocumentSubtype::Regular
                },
            },
        );

        let response = self
            .document_service
            .create_document(user_id.clone(), args, None)
            .await?;

        let document_id = response
            .document_response
            .document_metadata
            .document_id
            .clone();

        let finalize_result = async {
            if let Some((property_values, share_with_team)) = task {
                self.document_service
                    .handle_task_properties(
                        user_id,
                        &document_id,
                        &CreateTaskRequest {
                            task_name,
                            project_id,
                            property_values,
                            share_with_team,
                        },
                    )
                    .await?;
            }

            self.document_service
                .mark_document_uploaded(&document_id)
                .await?;

            self.markdown_initializer()
                .initialize_existing_markdown(&document_id, &markdown)
                .await?;

            Ok(())
        }
        .await;

        if let Err(error) = finalize_result {
            self.cleanup_created_document(&document_id).await;
            return Err(error);
        }

        Ok(CreatedDocument::new(response))
    }

    /// Create a text file and upload it to document storage.
    #[tracing::instrument(skip(self, document), err)]
    pub async fn create_text_file(
        &self,
        user_id: MacroUserIdStr<'static>,
        document: NewTextFileDocument,
    ) -> Result<CreatedDocument, DocumentError> {
        let NewTextFileDocument {
            metadata,
            file_type,
            text,
        } = document;

        let bytes = text.into_bytes();
        let hashes = file_shas(&bytes);
        let args = metadata.into_repo_args(
            user_id.clone(),
            RepoDocumentKind {
                file_type: Some(file_type.into_file_type()),
                sha: hashes.hex,
                subtype: RepoDocumentSubtype::Regular,
            },
        );

        let response = self
            .document_service
            .create_document(user_id, args, None)
            .await?;

        let document_id = response
            .document_response
            .document_metadata
            .document_id
            .clone();

        let finalize_result = async {
            let presigned_url = response
                .document_response
                .presigned_url
                .as_ref()
                .context("expected presigned url")
                .map_err(DocumentError::Internal)?;

            self.upload_to_presigned_url(
                presigned_url,
                &response.content_type,
                &hashes.base64,
                bytes,
            )
            .await?;

            self.document_service
                .mark_document_uploaded(&document_id)
                .await?;

            Ok(())
        }
        .await;

        if let Err(error) = finalize_result {
            self.cleanup_created_document(&document_id).await;
            return Err(error);
        }

        Ok(CreatedDocument::new(response))
    }

    fn markdown_initializer(&self) -> MarkdownInitializer<'_> {
        MarkdownInitializer::new(self.lexical_client, self.sync_service_client)
    }

    async fn cleanup_created_document(&self, document_id: &str) {
        self.document_service
            .cleanup_created_document(document_id)
            .await;
    }

    async fn upload_to_presigned_url(
        &self,
        presigned_url: &str,
        content_type: &str,
        base64_sha: &str,
        bytes: Vec<u8>,
    ) -> Result<(), DocumentError> {
        let upload_response = self
            .http_client
            .put(presigned_url)
            .header("content-type", content_type)
            .header("x-amz-checksum-sha256", base64_sha)
            .body(bytes)
            .send()
            .await
            .map_err(|e| DocumentError::Internal(e.into()))?;

        if !upload_response.status().is_success() {
            let status = upload_response.status();
            let body = upload_response.text().await.unwrap_or_default();
            return Err(DocumentError::Internal(anyhow::anyhow!(
                "presigned url upload failed: {status} {body}"
            )));
        }

        Ok(())
    }
}

#[derive(Debug)]
struct FileShas {
    hex: String,
    base64: String,
}

fn file_shas(file_content: &[u8]) -> FileShas {
    let mut hasher = Sha256::new();
    hasher.update(file_content);
    let file_hash_result = hasher.finalize();
    let hex = format!("{file_hash_result:x}");
    let base64 = base64::engine::general_purpose::STANDARD.encode(file_hash_result);

    FileShas { hex, base64 }
}

#[cfg(test)]
mod tests {
    use super::{MarkdownSubtype, NewDocumentMetadata, NewPlainTextDocument, file_shas};
    use model::document::FileType;

    fn metadata() -> NewDocumentMetadata {
        NewDocumentMetadata {
            id: None,
            document_name: "test".to_string(),
            project_id: None,
            email_attachment_id: None,
            created_at: None,
            skip_history: false,
        }
    }

    #[test]
    fn new_plain_text_rejects_non_markdown_task() {
        let err = NewPlainTextDocument::new(
            metadata(),
            FileType::Txt,
            "hello".to_string(),
            MarkdownSubtype::from_task_flag(true),
        )
        .unwrap_err();

        assert_eq!(
            err.to_string(),
            "bad request: tasks must be markdown documents"
        );
    }

    #[test]
    fn new_plain_text_accepts_markdown_task() {
        NewPlainTextDocument::new(
            metadata(),
            FileType::Md,
            "# hello".to_string(),
            MarkdownSubtype::from_task_flag(true),
        )
        .unwrap();
    }

    #[test]
    fn test_file_shas() {
        let hashes = file_shas(b"hello");
        assert_eq!(
            hashes.hex,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert_eq!(
            hashes.base64,
            "LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ="
        );
    }
}
