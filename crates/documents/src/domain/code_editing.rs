//! Permission-scoped, deterministic editing of collaborative markdown state.
use super::{
    permission_token::encode_permission_token,
    ports::{DocumentService, editing::EditingWorkerService},
};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

/// Exact state at the revision used by a later edit.
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentState {
    /// Authorized document.
    pub document_id: String,
    /// Opaque sync revision; do not construct or modify it.
    pub revision: String,
    /// Readable content with durable node IDs.
    pub xml: String,
    /// Complete serialized Lexical state.
    pub state: Value,
    /// IDs accepted by the editing library.
    pub node_ids: Vec<String>,
}

/// A batch acknowledged by the sync service.
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentUpdate {
    /// Document changed by this batch.
    pub document_id: String,
    /// Committed revision.
    pub revision: String,
    /// Whether this request added changes.
    pub applied: bool,
}

/// Typed worker response; transport decoding stays in the outbound adapter.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum CodeDocumentResponse {
    /// Complete view of the document.
    State(DocumentState),
    /// An acknowledged mutation.
    Update(DocumentUpdate),
}

/// Worker-side editing uses the shared TypeScript operation vocabulary.
#[derive(Debug, Serialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum CodeDocumentRequest {
    /// Read without mutation.
    Read,
    /// Validate on a private copy, then commit its delta atomically.
    #[serde(rename_all = "camelCase")]
    Edit {
        /// Revision observed by the caller.
        expected_revision: String,
        /// Bounded operations, validated against the shared editor at the worker.
        operations: Vec<Value>,
    },
}

/// The one metadata fact required by deterministic markdown workflows.
#[cfg_attr(test, mockall::automock)]
pub trait CodeDocumentLookup: Send + Sync + 'static {
    /// Current document type.
    fn file_type(
        &self,
        id: &str,
    ) -> impl std::future::Future<Output = anyhow::Result<Option<String>>> + Send;
}

impl<D: DocumentService> CodeDocumentLookup for D {
    async fn file_type(&self, id: &str) -> anyhow::Result<Option<String>> {
        Ok(self.internal_get_basic_document(id).await?.file_type)
    }
}

/// Owns format policy, request bounds and narrowly scoped permission tokens.
pub struct CodeEditingService<D, W> {
    documents: Arc<D>,
    worker: Arc<W>,
    secret: String,
}

impl<D: CodeDocumentLookup, W: EditingWorkerService> CodeEditingService<D, W> {
    /// Compose the metadata and worker capabilities.
    pub fn new(documents: Arc<D>, worker: Arc<W>, secret: String) -> Self {
        Self {
            documents,
            worker,
            secret,
        }
    }

    /// Read requires only a View receipt.
    pub async fn read(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        user: &MacroUserIdStr<'_>,
        actor: &str,
    ) -> anyhow::Result<DocumentState> {
        match self
            .run(
                &receipt.entity().entity_id,
                user,
                actor,
                AccessLevel::View,
                CodeDocumentRequest::Read,
            )
            .await?
        {
            CodeDocumentResponse::State(state) => Ok(state),
            _ => anyhow::bail!("Editing worker returned the wrong response type."),
        }
    }

    /// Apply requires an Edit receipt; stale revisions never overwrite another edit.
    pub async fn apply(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        user: &MacroUserIdStr<'_>,
        actor: &str,
        expected_revision: String,
        operations: Vec<Value>,
    ) -> anyhow::Result<DocumentUpdate> {
        anyhow::ensure!(
            !expected_revision.is_empty() && expected_revision.len() <= 32_768,
            "Read a current document revision before editing."
        );
        anyhow::ensure!(
            !operations.is_empty() && operations.len() <= 200,
            "Send between 1 and 200 editor operations."
        );
        anyhow::ensure!(
            serde_json::to_vec(&operations)?.len() <= 192 * 1024,
            "Document edit batch exceeds 192 KiB."
        );
        match self
            .run(
                &receipt.entity().entity_id,
                user,
                actor,
                AccessLevel::Edit,
                CodeDocumentRequest::Edit {
                    expected_revision,
                    operations,
                },
            )
            .await?
        {
            CodeDocumentResponse::Update(update) => Ok(update),
            _ => anyhow::bail!("Editing worker returned the wrong response type."),
        }
    }

    async fn run(
        &self,
        id: &str,
        user: &MacroUserIdStr<'_>,
        actor: &str,
        access: AccessLevel,
        request: CodeDocumentRequest,
    ) -> anyhow::Result<CodeDocumentResponse> {
        anyhow::ensure!(
            self.documents.file_type(id).await?.as_deref() == Some("md"),
            "The code editor supports Macro markdown documents only. Use the existing file-specific tools for other formats."
        );
        let token = encode_permission_token(
            Some(user.to_string()),
            id.to_owned(),
            access,
            &self.secret,
            Some(actor.to_owned()),
        )?;
        self.worker.code_document(id, &token, &request).await
    }
}

#[cfg(test)]
mod test;
