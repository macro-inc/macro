//! Document creation orchestration.
//!
//! Callers describe the document kind at the type level with marker structs like
//! [`MarkdownText`], [`TextFile`], and [`FileUpload`]. Each marker owns its
//! creation behavior and content shape.

use std::{future::Future, marker::PhantomData};

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

/// A document to create, parameterized by its kind.
#[derive(Debug, Clone)]
pub struct NewDocument<K: DocumentKind> {
    /// Common document metadata.
    pub metadata: NewDocumentMetadata,
    /// Kind-specific content.
    pub content: K::Content,
    _kind: PhantomData<K>,
}

impl<K: DocumentKind> NewDocument<K> {
    /// Construct a new document description.
    pub fn new(metadata: NewDocumentMetadata, content: K::Content) -> Self {
        Self {
            metadata,
            content,
            _kind: PhantomData,
        }
    }
}

/// Marker trait for document kinds.
pub trait DocumentKind: Send + Sync + 'static {
    /// Content required to create this kind of document.
    type Content: Send + Sync;
    /// Result returned after creating this kind of document.
    type Created: Send;

    /// Create this kind of document.
    fn create<'a, Svc: DocumentService>(
        creator: &'a DocumentCreator<'_, Svc>,
        user_id: MacroUserIdStr<'static>,
        document: NewDocument<Self>,
    ) -> impl Future<Output = Result<Self::Created, DocumentError>> + Send + 'a
    where
        Self: Sized,
        Self::Content: 'a,
        Self::Created: 'a;
}

/// Markdown source text. Creation initializes sync-service immediately.
#[derive(Debug)]
pub struct MarkdownText;

/// Backend-created text file. Creation uploads content to document storage.
#[derive(Debug)]
pub struct TextFile;

/// Non-markdown file whose bytes will be uploaded by the caller.
#[derive(Debug)]
pub struct FileUpload;

/// Markdown file whose bytes will be uploaded by the caller.
///
/// Creation only creates metadata and a presigned URL. A later finalize step
/// should read the uploaded markdown and initialize sync-service.
#[derive(Debug)]
pub struct MarkdownUpload;

/// Content for [`MarkdownText`].
#[derive(Debug, Clone)]
pub struct MarkdownTextContent {
    /// Markdown source text.
    pub markdown: String,
    /// Markdown subtype.
    pub subtype: MarkdownSubtype,
}

impl MarkdownTextContent {
    /// Construct an empty markdown note.
    pub fn empty_note() -> Self {
        Self {
            markdown: String::new(),
            subtype: MarkdownSubtype::Note,
        }
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

/// A file type that is known not to be markdown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NonMarkdownFileType(FileType);

impl NonMarkdownFileType {
    /// Create a non-markdown file type, rejecting [`FileType::Md`].
    pub fn new(file_type: FileType) -> Result<Self, DocumentError> {
        if file_type == FileType::Md {
            return Err(DocumentError::BadRequest(
                "md documents must use MarkdownText or MarkdownUpload".to_string(),
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

/// Content for [`TextFile`].
#[derive(Debug, Clone)]
pub struct TextFileContent {
    /// Text document file type. Markdown is excluded by construction.
    pub file_type: NonMarkdownFileType,
    /// Text content to upload.
    pub text: String,
}

/// Content for [`FileUpload`].
#[derive(Debug, Clone)]
pub struct FileUploadContent {
    /// File type for the upload, if known. Markdown is excluded by construction.
    pub file_type: Option<NonMarkdownFileType>,
    /// Hex-encoded sha256 of the future upload bytes.
    pub sha: String,
    /// Optional upload job id to associate with the document.
    pub job_id: Option<String>,
}

/// Content for [`MarkdownUpload`].
#[derive(Debug, Clone)]
pub struct MarkdownUploadContent {
    /// Hex-encoded sha256 of the future markdown upload bytes.
    pub sha: String,
    /// Optional upload job id to associate with the document.
    pub job_id: Option<String>,
}

/// A fully created document.
#[derive(Debug)]
pub struct CreatedDocument<K: DocumentKind> {
    response: CreateDocumentResponseData,
    _kind: PhantomData<K>,
}

impl<K: DocumentKind> CreatedDocument<K> {
    fn new(response: CreateDocumentResponseData) -> Self {
        Self {
            response,
            _kind: PhantomData,
        }
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

/// A document waiting for caller-managed upload bytes.
#[derive(Debug)]
pub struct PendingUploadDocument<K: DocumentKind> {
    response: CreateDocumentResponseData,
    _kind: PhantomData<K>,
}

impl<K: DocumentKind> PendingUploadDocument<K> {
    fn new(response: CreateDocumentResponseData) -> Self {
        Self {
            response,
            _kind: PhantomData,
        }
    }

    /// The created document id.
    pub fn document_id(&self) -> &str {
        &self
            .response
            .document_response
            .document_metadata
            .document_id
    }

    /// The presigned upload URL, if one was returned.
    pub fn presigned_url(&self) -> Option<&str> {
        self.response.document_response.presigned_url.as_deref()
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

impl DocumentKind for MarkdownText {
    type Content = MarkdownTextContent;
    type Created = CreatedDocument<MarkdownText>;

    fn create<'a, Svc: DocumentService>(
        creator: &'a DocumentCreator<'_, Svc>,
        user_id: MacroUserIdStr<'static>,
        document: NewDocument<Self>,
    ) -> impl Future<Output = Result<Self::Created, DocumentError>> + Send + 'a
    where
        Self::Content: 'a,
        Self::Created: 'a,
    {
        async move { creator.create_markdown_text(user_id, document).await }
    }
}

impl DocumentKind for TextFile {
    type Content = TextFileContent;
    type Created = CreatedDocument<TextFile>;

    fn create<'a, Svc: DocumentService>(
        creator: &'a DocumentCreator<'_, Svc>,
        user_id: MacroUserIdStr<'static>,
        document: NewDocument<Self>,
    ) -> impl Future<Output = Result<Self::Created, DocumentError>> + Send + 'a
    where
        Self::Content: 'a,
        Self::Created: 'a,
    {
        async move { creator.create_text_file(user_id, document).await }
    }
}

impl DocumentKind for FileUpload {
    type Content = FileUploadContent;
    type Created = PendingUploadDocument<FileUpload>;

    fn create<'a, Svc: DocumentService>(
        creator: &'a DocumentCreator<'_, Svc>,
        user_id: MacroUserIdStr<'static>,
        document: NewDocument<Self>,
    ) -> impl Future<Output = Result<Self::Created, DocumentError>> + Send + 'a
    where
        Self::Content: 'a,
        Self::Created: 'a,
    {
        async move { creator.begin_file_upload(user_id, document).await }
    }
}

impl DocumentKind for MarkdownUpload {
    type Content = MarkdownUploadContent;
    type Created = PendingUploadDocument<MarkdownUpload>;

    fn create<'a, Svc: DocumentService>(
        creator: &'a DocumentCreator<'_, Svc>,
        user_id: MacroUserIdStr<'static>,
        document: NewDocument<Self>,
    ) -> impl Future<Output = Result<Self::Created, DocumentError>> + Send + 'a
    where
        Self::Content: 'a,
        Self::Created: 'a,
    {
        async move { creator.begin_markdown_upload(user_id, document).await }
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
    /// This is used by flows where metadata was created elsewhere, such as bulk
    /// folder upload. It is still centralized here so callers do not know about
    /// lexical-service or sync-service wiring.
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

/// Service for creating documents from typed [`NewDocument`] values.
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

    /// Create a document from its typed description.
    #[tracing::instrument(skip(self, document), err)]
    pub async fn create<K: DocumentKind>(
        &self,
        user_id: MacroUserIdStr<'static>,
        document: NewDocument<K>,
    ) -> Result<K::Created, DocumentError> {
        K::create(self, user_id, document).await
    }

    /// Create a markdown text document and initialize sync-service.
    #[tracing::instrument(skip(self, document), err)]
    pub async fn create_markdown_text(
        &self,
        user_id: MacroUserIdStr<'static>,
        document: NewDocument<MarkdownText>,
    ) -> Result<CreatedDocument<MarkdownText>, DocumentError> {
        let NewDocument {
            metadata,
            content: MarkdownTextContent { markdown, subtype },
            _kind,
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

        self.markdown_initializer()
            .initialize_existing_markdown(&document_id, &markdown)
            .await?;

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

        Ok(CreatedDocument::new(response))
    }

    /// Create a text file and upload it to document storage.
    #[tracing::instrument(skip(self, document), err)]
    pub async fn create_text_file(
        &self,
        user_id: MacroUserIdStr<'static>,
        document: NewDocument<TextFile>,
    ) -> Result<CreatedDocument<TextFile>, DocumentError> {
        let NewDocument {
            metadata,
            content: TextFileContent { file_type, text },
            _kind,
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

        let presigned_url = response
            .document_response
            .presigned_url
            .as_ref()
            .context("expected presigned url")
            .map_err(DocumentError::Internal)?;

        self.upload_to_presigned_url(presigned_url, &response.content_type, &hashes.base64, bytes)
            .await?;

        Ok(CreatedDocument::new(response))
    }

    /// Create metadata and a presigned upload URL for a non-markdown file.
    #[tracing::instrument(skip(self, document), err)]
    pub async fn begin_file_upload(
        &self,
        user_id: MacroUserIdStr<'static>,
        document: NewDocument<FileUpload>,
    ) -> Result<PendingUploadDocument<FileUpload>, DocumentError> {
        let NewDocument {
            metadata,
            content:
                FileUploadContent {
                    file_type,
                    sha,
                    job_id,
                },
            _kind,
        } = document;
        let args = metadata.into_repo_args(
            user_id.clone(),
            RepoDocumentKind {
                file_type: file_type.map(NonMarkdownFileType::into_file_type),
                sha,
                subtype: RepoDocumentSubtype::Regular,
            },
        );

        self.document_service
            .create_document(user_id, args, job_id)
            .await
            .map(PendingUploadDocument::new)
    }

    /// Create metadata and a presigned upload URL for a markdown file.
    #[tracing::instrument(skip(self, document), err)]
    pub async fn begin_markdown_upload(
        &self,
        user_id: MacroUserIdStr<'static>,
        document: NewDocument<MarkdownUpload>,
    ) -> Result<PendingUploadDocument<MarkdownUpload>, DocumentError> {
        let NewDocument {
            metadata,
            content: MarkdownUploadContent { sha, job_id },
            _kind,
        } = document;
        let args = metadata.into_repo_args(
            user_id.clone(),
            RepoDocumentKind {
                file_type: Some(FileType::Md),
                sha,
                subtype: RepoDocumentSubtype::Regular,
            },
        );

        self.document_service
            .create_document(user_id, args, job_id)
            .await
            .map(PendingUploadDocument::new)
    }

    fn markdown_initializer(&self) -> MarkdownInitializer<'_> {
        MarkdownInitializer::new(self.lexical_client, self.sync_service_client)
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
    use super::file_shas;

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
