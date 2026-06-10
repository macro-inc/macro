//! Backend-owned document creation orchestration.
//!
//! This module keeps creation policy in one place. It intentionally exposes
//! explicit creation methods rather than a generic document-kind dispatcher:
//! call sites should choose the lifecycle they need (`create_markdown_text` or
//! `create_text_file`).

use anyhow::Context;
use base64::Engine;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;
use sha2::{Digest, Sha256};

use crate::domain::content::{DocumentContent, DocumentContentLocation};
use crate::domain::models::{
    CreateDocumentRepoArgs, CreateTaskRequest, DocumentError, EMPTY_SHA256, PropertyInput,
};
use crate::domain::ports::create::{
    DocumentBytesUpload, DocumentBytesUploadPort, DocumentCreationService,
};
use crate::domain::ports::markdown::MarkdownInitializationPort;
use crate::domain::response::CreateDocumentResponseData;

/// Common metadata for a document that has not been created yet.
#[derive(Debug, Clone)]
pub struct NewDocumentMetadata {
    id: Option<uuid::Uuid>,
    document_name: String,
    project_id: Option<uuid::Uuid>,
    email_attachment_id: Option<uuid::Uuid>,
    created_at: Option<chrono::DateTime<chrono::Utc>>,
    skip_history: bool,
}

impl NewDocumentMetadata {
    /// Construct metadata with default optional fields.
    pub fn new(document_name: impl Into<String>) -> Self {
        Self::builder(document_name).build()
    }

    /// Build document metadata with optional fields.
    pub fn builder(document_name: impl Into<String>) -> NewDocumentMetadataBuilder {
        NewDocumentMetadataBuilder {
            metadata: Self {
                id: None,
                document_name: document_name.into(),
                project_id: None,
                email_attachment_id: None,
                created_at: None,
                skip_history: false,
            },
        }
    }

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
            team_id: kind.team_id,
            email_attachment_id: self.email_attachment_id,
            created_at: self.created_at,
            sub_type: kind.subtype.sub_type(),
            skip_history: self.skip_history,
        }
    }
}

/// Builder for [`NewDocumentMetadata`].
#[derive(Debug, Clone)]
pub struct NewDocumentMetadataBuilder {
    metadata: NewDocumentMetadata,
}

impl NewDocumentMetadataBuilder {
    /// Set a caller-provided document id.
    pub fn id(mut self, id: uuid::Uuid) -> Self {
        self.metadata.id = Some(id);
        self
    }

    /// Set the project to associate with the document.
    pub fn project_id(mut self, project_id: uuid::Uuid) -> Self {
        self.metadata.project_id = Some(project_id);
        self
    }

    /// Set an email attachment to link to this document.
    pub fn email_attachment_id(mut self, email_attachment_id: uuid::Uuid) -> Self {
        self.metadata.email_attachment_id = Some(email_attachment_id);
        self
    }

    /// Set a custom creation timestamp.
    pub fn created_at(mut self, created_at: chrono::DateTime<chrono::Utc>) -> Self {
        self.metadata.created_at = Some(created_at);
        self
    }

    /// Skip adding this document to user history.
    pub fn skip_history(mut self) -> Self {
        self.metadata.skip_history = true;
        self
    }

    /// Build the metadata value.
    pub fn build(self) -> NewDocumentMetadata {
        self.metadata
    }
}

struct RepoDocumentKind {
    file_type: Option<FileType>,
    sha: String,
    subtype: RepoDocumentSubtype,
    team_id: Option<uuid::Uuid>,
}

enum RepoDocumentSubtype {
    Regular,
    MarkdownTask,
    MarkdownSnippet,
}

impl RepoDocumentSubtype {
    fn sub_type(&self) -> Option<document_sub_type::DocumentSubType> {
        match self {
            RepoDocumentSubtype::Regular => None,
            RepoDocumentSubtype::MarkdownTask => Some(document_sub_type::DocumentSubType::Task),
            RepoDocumentSubtype::MarkdownSnippet => {
                Some(document_sub_type::DocumentSubType::Snippet)
            }
        }
    }
}

/// Markdown-specific subtype. Task-ness and snippet-ness only exist for
/// markdown documents.
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
        /// Team to assign the task number within. If omitted, it is inferred only
        /// when the creator belongs to exactly one team.
        team_id: Option<uuid::Uuid>,
    },
    /// A snippet document — reusable markdown insertable in any markdown area.
    /// Snippets are created personal; team sharing is toggled separately.
    Snippet,
}

impl MarkdownSubtype {
    /// Convert a simple task flag into the default markdown subtype.
    pub fn from_task_flag(is_task: bool) -> Self {
        if is_task {
            Self::Task {
                property_values: None,
                share_with_team: true,
                team_id: None,
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

/// Marker for a plaintext document builder missing a file type.
#[derive(Debug, Clone)]
pub struct MissingPlainTextFileType;

/// Marker for a plaintext document builder missing text content.
#[derive(Debug, Clone)]
pub struct MissingPlainTextContent;

/// Builder for [`NewPlainTextDocument`].
#[derive(Debug, Clone)]
pub struct NewPlainTextDocumentBuilder<FileTypeState, TextState> {
    metadata: NewDocumentMetadata,
    file_type: FileTypeState,
    text: TextState,
    markdown_subtype: MarkdownSubtype,
}

impl NewPlainTextDocument {
    /// Start building a plaintext document.
    pub fn builder(
        metadata: NewDocumentMetadata,
    ) -> NewPlainTextDocumentBuilder<MissingPlainTextFileType, MissingPlainTextContent> {
        NewPlainTextDocumentBuilder {
            metadata,
            file_type: MissingPlainTextFileType,
            text: MissingPlainTextContent,
            markdown_subtype: MarkdownSubtype::Note,
        }
    }

    /// Construct a plaintext document from a file type, rejecting impossible
    /// combinations like task documents with non-markdown file types.
    pub fn new(
        metadata: NewDocumentMetadata,
        file_type: FileType,
        text: String,
        markdown_subtype: MarkdownSubtype,
    ) -> Result<Self, DocumentError> {
        Self::builder(metadata)
            .file_type(file_type)
            .text(text)
            .markdown_subtype(markdown_subtype)
            .build()
    }
}

impl<TextState> NewPlainTextDocumentBuilder<MissingPlainTextFileType, TextState> {
    /// Set the document file type.
    pub fn file_type(
        self,
        file_type: FileType,
    ) -> NewPlainTextDocumentBuilder<FileType, TextState> {
        NewPlainTextDocumentBuilder {
            metadata: self.metadata,
            file_type,
            text: self.text,
            markdown_subtype: self.markdown_subtype,
        }
    }
}

impl<FileTypeState> NewPlainTextDocumentBuilder<FileTypeState, MissingPlainTextContent> {
    /// Set the text content.
    pub fn text(
        self,
        text: impl Into<String>,
    ) -> NewPlainTextDocumentBuilder<FileTypeState, String> {
        NewPlainTextDocumentBuilder {
            metadata: self.metadata,
            file_type: self.file_type,
            text: text.into(),
            markdown_subtype: self.markdown_subtype,
        }
    }
}

impl<FileTypeState, TextState> NewPlainTextDocumentBuilder<FileTypeState, TextState> {
    /// Set the markdown subtype used when `file_type` is markdown.
    pub fn markdown_subtype(mut self, markdown_subtype: MarkdownSubtype) -> Self {
        self.markdown_subtype = markdown_subtype;
        self
    }

    /// Set the markdown subtype from a simple task flag.
    pub fn task_flag(self, is_task: bool) -> Self {
        self.markdown_subtype(MarkdownSubtype::from_task_flag(is_task))
    }
}

impl NewPlainTextDocumentBuilder<FileType, String> {
    /// Build the document description.
    pub fn build(self) -> Result<NewPlainTextDocument, DocumentError> {
        let kind = if self.file_type == FileType::Md {
            PlainTextDocumentKind::Markdown(self.markdown_subtype)
        } else {
            match self.markdown_subtype {
                MarkdownSubtype::Task { .. } => {
                    return Err(DocumentError::BadRequest(
                        "tasks must be markdown documents".to_string(),
                    ));
                }
                MarkdownSubtype::Snippet => {
                    return Err(DocumentError::BadRequest(
                        "snippets must be markdown documents".to_string(),
                    ));
                }
                MarkdownSubtype::Note => {}
            }
            PlainTextDocumentKind::Text(NonMarkdownFileType::new(self.file_type)?)
        };

        Ok(NewPlainTextDocument {
            metadata: self.metadata,
            text: self.text,
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
            .metadata
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

/// Service for creating backend-owned document content.
#[derive(Clone)]
pub struct DocumentCreator<Svc, MarkdownInit, BytesUpload> {
    document_service: Svc,
    markdown_initializer: MarkdownInit,
    bytes_uploader: BytesUpload,
}

impl<Svc, MarkdownInit, BytesUpload> DocumentCreator<Svc, MarkdownInit, BytesUpload> {
    /// Construct a document creator.
    pub fn new(
        document_service: Svc,
        markdown_initializer: MarkdownInit,
        bytes_uploader: BytesUpload,
    ) -> Self {
        Self {
            document_service,
            markdown_initializer,
            bytes_uploader,
        }
    }
}

impl<Svc, MarkdownInit, BytesUpload> DocumentCreator<Svc, MarkdownInit, BytesUpload>
where
    Svc: DocumentCreationService,
    MarkdownInit: MarkdownInitializationPort,
    BytesUpload: DocumentBytesUploadPort,
{
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
            MarkdownSubtype::Note | MarkdownSubtype::Snippet => None,
            MarkdownSubtype::Task {
                property_values,
                share_with_team,
                team_id,
            } => Some((property_values.clone(), *share_with_team, *team_id)),
        };

        let task_name = metadata.document_name.clone();
        let project_id = metadata.project_id;
        let team_id = if let Some((_, _, team_id)) = task.as_ref() {
            *team_id
        } else {
            None
        };

        let args = metadata.into_repo_args(
            user_id.clone(),
            RepoDocumentKind {
                file_type: Some(FileType::Md),
                sha: EMPTY_SHA256.to_string(),
                subtype: match &subtype {
                    MarkdownSubtype::Note => RepoDocumentSubtype::Regular,
                    MarkdownSubtype::Task { .. } => RepoDocumentSubtype::MarkdownTask,
                    MarkdownSubtype::Snippet => RepoDocumentSubtype::MarkdownSnippet,
                },
                team_id,
            },
        );

        let mut response = self
            .document_service
            .create_document(user_id.clone(), args, None)
            .await?;

        let document_id = response
            .document_response
            .document_metadata
            .metadata
            .document_id
            .clone();

        let finalize_result = async {
            if let Some((property_values, share_with_team, team_id)) = task {
                self.document_service
                    .handle_task_properties(
                        user_id,
                        &document_id,
                        &CreateTaskRequest {
                            task_name,
                            markdown: None,
                            project_id,
                            team_id,
                            property_values,
                            share_with_team,
                        },
                    )
                    .await?;
            }

            self.markdown_initializer
                .initialize_existing_markdown(&document_id, &markdown)
                .await?;

            self.document_service
                .set_document_content(
                    &document_id,
                    DocumentContent::ready(DocumentContentLocation::SyncService),
                )
                .await?;

            Ok(())
        }
        .await;

        if let Err(error) = finalize_result {
            self.cleanup_created_document(&document_id).await;
            return Err(error);
        }

        response.document_response.document_metadata.content =
            DocumentContent::ready(DocumentContentLocation::SyncService);

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
                team_id: None,
            },
        );

        let mut response = self
            .document_service
            .create_document(user_id, args, None)
            .await?;

        let document_id = response
            .document_response
            .document_metadata
            .metadata
            .document_id
            .clone();

        let finalize_result = async {
            let presigned_url = response
                .document_response
                .presigned_url
                .as_ref()
                .context("expected presigned url")
                .map_err(DocumentError::Internal)?;

            self.bytes_uploader
                .upload_document_bytes(DocumentBytesUpload {
                    presigned_url: presigned_url.clone(),
                    content_type: response.content_type.clone(),
                    base64_sha256: hashes.base64,
                    bytes,
                })
                .await?;

            self.document_service
                .set_document_content(
                    &document_id,
                    DocumentContent::ready(DocumentContentLocation::ObjectStorage),
                )
                .await?;

            Ok(())
        }
        .await;

        if let Err(error) = finalize_result {
            self.cleanup_created_document(&document_id).await;
            return Err(error);
        }

        response.document_response.document_metadata.content =
            DocumentContent::ready(DocumentContentLocation::ObjectStorage);

        Ok(CreatedDocument::new(response))
    }

    async fn cleanup_created_document(&self, document_id: &str) {
        self.document_service
            .cleanup_created_document(document_id)
            .await;
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
        NewDocumentMetadata::new("test")
    }

    #[test]
    fn new_plain_text_rejects_non_markdown_task() {
        let err = NewPlainTextDocument::builder(metadata())
            .file_type(FileType::Txt)
            .text("hello")
            .markdown_subtype(MarkdownSubtype::from_task_flag(true))
            .build()
            .unwrap_err();

        assert_eq!(
            err.to_string(),
            "bad request: tasks must be markdown documents"
        );
    }

    #[test]
    fn new_plain_text_accepts_markdown_task() {
        NewPlainTextDocument::builder(metadata())
            .file_type(FileType::Md)
            .text("# hello")
            .task_flag(true)
            .build()
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
