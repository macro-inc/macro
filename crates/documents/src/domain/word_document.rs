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

/// Narrow document metadata capability the Word document workflows need.
#[cfg_attr(test, mockall::automock)]
pub trait WordDocumentLookup: Send + Sync + 'static {
    /// The document's file type, as stored.
    fn file_type(
        &self,
        document_id: &str,
    ) -> impl std::future::Future<Output = anyhow::Result<Option<String>>> + Send;
}

impl<D: DocumentService> WordDocumentLookup for D {
    async fn file_type(&self, document_id: &str) -> anyhow::Result<Option<String>> {
        Ok(self
            .internal_get_basic_document(document_id)
            .await?
            .file_type)
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

    /// Apply an atomic batch of edits to the live document.
    pub async fn edit(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        user: &MacroUserIdStr<'_>,
        actor: &str,
        operations: Vec<WordDocumentOperation>,
    ) -> anyhow::Result<WordDocumentResponse> {
        anyhow::ensure!(
            !operations.is_empty() && operations.len() <= MAX_OPERATIONS,
            "Send between 1 and {MAX_OPERATIONS} operations."
        );
        self.run(
            &receipt.entity().entity_id,
            user,
            actor,
            AccessLevel::Edit,
            WordDocumentRequest::Edit { operations },
        )
        .await
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

#[cfg(test)]
mod test;
