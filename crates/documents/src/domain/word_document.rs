//! Reading and editing uploaded Word (`.docx`) documents for AI tools.
//!
//! A DOCX has a live collaborative copy in the sync service; the editing
//! worker reads and edits that copy, so people with the document open see an
//! agent's edits as they land. The first editor to open an upload seeds the
//! copy; when an agent gets there first, this service seeds it the same way.

mod models;
mod seed;
pub use models::*;
pub use seed::seed_snapshot;

use super::{
    markdown_backfill::SyncServiceProbe,
    permission_token::encode_permission_token,
    ports::{DocumentService, editing::EditingWorkerService, markdown::SyncInitializeSnapshotPort},
};
use anyhow::Context;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use std::sync::Arc;

/// Most operations one edit may apply.
pub const MAX_OPERATIONS: usize = 50;

/// Longest author name an edit may record.
pub const MAX_AUTHOR_LENGTH: usize = 100;

/// Narrow document metadata capability the Word document workflows need.
#[cfg_attr(test, mockall::automock)]
pub trait WordDocumentLookup: Send + Sync + 'static {
    /// The document's file type, as stored.
    fn file_type(
        &self,
        document_id: &str,
    ) -> impl std::future::Future<Output = anyhow::Result<Option<String>>> + Send;

    /// The name a user goes by, when they set one.
    fn display_name(
        &self,
        user_id: &str,
    ) -> impl std::future::Future<Output = anyhow::Result<Option<String>>> + Send;
}

impl<D: DocumentService> WordDocumentLookup for D {
    async fn file_type(&self, document_id: &str) -> anyhow::Result<Option<String>> {
        Ok(self
            .internal_get_basic_document(document_id)
            .await?
            .file_type)
    }

    async fn display_name(&self, user_id: &str) -> anyhow::Result<Option<String>> {
        Ok(self.internal_get_user_display_name(user_id).await?)
    }
}

/// Reads uploaded Word files. Object-safe so hosts can wire a store into an
/// already-built tool context.
#[async_trait::async_trait]
pub trait WordDocumentFiles: Send + Sync + 'static {
    /// The DOCX as uploaded, or `None` while the upload is still being
    /// extracted.
    async fn original(&self, document_id: &str) -> anyhow::Result<Option<Vec<u8>>>;
}

/// Used where no file store is wired: seeding fails with a clear message.
pub struct NoWordDocumentFiles;

#[async_trait::async_trait]
impl WordDocumentFiles for NoWordDocumentFiles {
    async fn original(&self, _document_id: &str) -> anyhow::Result<Option<Vec<u8>>> {
        anyhow::bail!("Word documents nobody has opened yet cannot be prepared from this host")
    }
}

/// Runs Word document workflows after the caller obtains the required receipt.
pub struct WordDocumentService<D, W, S> {
    documents: Arc<D>,
    worker: Arc<W>,
    sync: Arc<S>,
    files: Arc<dyn WordDocumentFiles>,
    token_secret: String,
}

impl<D, W, S> WordDocumentService<D, W, S>
where
    D: WordDocumentLookup,
    W: EditingWorkerService,
    S: SyncServiceProbe + SyncInitializeSnapshotPort,
{
    /// Compose the domain service from document, execution, sync and file
    /// ports.
    pub fn new(
        documents: Arc<D>,
        worker: Arc<W>,
        sync: Arc<S>,
        files: Arc<dyn WordDocumentFiles>,
        token_secret: String,
    ) -> Self {
        Self {
            documents,
            worker,
            sync,
            files,
            token_secret,
        }
    }

    /// Describe the live document with its paragraph and table ids.
    pub async fn read(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        user: &MacroUserIdStr<'_>,
        actor: &str,
        start: Option<u32>,
        count: Option<u32>,
    ) -> anyhow::Result<WordDocumentResponse> {
        self.run(
            &receipt.entity().entity_id,
            user,
            actor,
            AccessLevel::View,
            WordDocumentRequest::Read { start, count },
        )
        .await
    }

    /// Apply an atomic batch of edits to the live document. Tracked changes
    /// and comments are attributed to `options.author`, else to the
    /// requesting user (never to the agent): they are the user's redline.
    pub async fn edit(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        user: &MacroUserIdStr<'_>,
        actor: &str,
        operations: Vec<WordDocumentOperation>,
        options: WordEditOptions,
    ) -> anyhow::Result<WordDocumentResponse> {
        anyhow::ensure!(
            !operations.is_empty() && operations.len() <= MAX_OPERATIONS,
            "Send between 1 and {MAX_OPERATIONS} operations."
        );
        let author = match options.author.as_deref().map(str::trim) {
            Some(name) if !name.is_empty() => {
                anyhow::ensure!(
                    name.chars().count() <= MAX_AUTHOR_LENGTH && !name.contains(['\n', '\r']),
                    "author must be one line of at most {MAX_AUTHOR_LENGTH} characters."
                );
                name.to_owned()
            }
            _ => self.user_name(user).await,
        };
        self.run(
            &receipt.entity().entity_id,
            user,
            actor,
            AccessLevel::Edit,
            WordDocumentRequest::Edit {
                operations,
                track_changes: options.track_changes,
                author,
            },
        )
        .await
    }

    /// The requesting user's name as Word should show it: the name they set,
    /// else their email's local part.
    async fn user_name(&self, user: &MacroUserIdStr<'_>) -> String {
        match self.documents.display_name(user.as_ref()).await {
            Ok(Some(name)) => name.chars().take(MAX_AUTHOR_LENGTH).collect(),
            Ok(None) => email_name(user),
            Err(error) => {
                tracing::warn!(error = ?error, "could not look up the user's name");
                email_name(user)
            }
        }
    }

    async fn run(
        &self,
        document_id: &str,
        user: &MacroUserIdStr<'_>,
        actor: &str,
        access: AccessLevel,
        request: WordDocumentRequest,
    ) -> anyhow::Result<WordDocumentResponse> {
        let file_type = self.documents.file_type(document_id).await?;
        anyhow::ensure!(
            file_type.as_deref() == Some("docx"),
            "This tool works on uploaded Word (.docx) documents only. Use EditDocument for Macro markdown documents and ReadContent for other files."
        );
        let token = encode_permission_token(
            Some(user.to_string()),
            document_id.to_owned(),
            access,
            &self.token_secret,
            Some(actor.to_owned()),
        )?;
        self.ensure_live_copy(document_id).await?;
        self.worker
            .word_document(document_id, &token, &request)
            .await
    }

    /// Seed the live copy from the uploaded file unless someone already has.
    #[tracing::instrument(
        name = "word_document.ensure_live_copy",
        skip(self),
        fields(seeded, docx_bytes, snapshot_bytes),
        err
    )]
    async fn ensure_live_copy(&self, document_id: &str) -> anyhow::Result<()> {
        let exists = self.sync.exists(document_id).await?;
        tracing::Span::current().record("seeded", !exists);
        if exists {
            return Ok(());
        }
        let Some(original) = self.files.original(document_id).await? else {
            anyhow::bail!(
                "This Word document is still being processed after upload. Try again in a few seconds."
            );
        };
        tracing::Span::current().record("docx_bytes", original.len());
        let snapshot = tokio::task::spawn_blocking(move || seed_snapshot(original))
            .await?
            .context("This Word document could not be opened for editing")?;
        tracing::Span::current().record("snapshot_bytes", snapshot.len());
        if let Err(error) = self
            .sync
            .initialize_from_snapshot(document_id, &snapshot)
            .await
        {
            // Someone opening the document may have seeded it first; both
            // seeds are the same document with the same ids.
            if !self.sync.exists(document_id).await? {
                return Err(error);
            }
        }
        Ok(())
    }
}

fn email_name(user: &MacroUserIdStr<'_>) -> String {
    let email = user.email_str();
    email.split('@').next().unwrap_or(email).to_owned()
}

#[cfg(test)]
mod test;
