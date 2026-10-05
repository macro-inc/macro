//! Reading and editing uploaded Word (`.docx`) documents for AI tools.
//!
//! A DOCX opened in Macro's editor has a live collaborative copy in the sync
//! service; the editing worker reads and edits that copy, so people with the
//! document open see an agent's edits as they land.

mod models;
pub use models::*;

use super::{
    permission_token::encode_permission_token,
    ports::{DocumentService, editing::EditingWorkerService},
};
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

/// Runs Word document workflows after the caller obtains the required receipt.
pub struct WordDocumentService<D, W> {
    documents: Arc<D>,
    worker: Arc<W>,
    token_secret: String,
}

impl<D: WordDocumentLookup, W: EditingWorkerService> WordDocumentService<D, W> {
    /// Compose the domain service from document and execution ports.
    pub fn new(documents: Arc<D>, worker: Arc<W>, token_secret: String) -> Self {
        Self {
            documents,
            worker,
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
        self.worker
            .word_document(document_id, &token, &request)
            .await
    }
}

fn email_name(user: &MacroUserIdStr<'_>) -> String {
    let email = user.email_str();
    email.split('@').next().unwrap_or(email).to_owned()
}

#[cfg(test)]
mod test;
