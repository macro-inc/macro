//! Permission-scoped spreadsheet workflows and their transport-independent commands.

mod instructions;
mod models;
pub use instructions::*;
pub use models::*;

use super::{
    models::DocumentError,
    permission_token::{encode_permission_token, encode_receipt_permission_token},
    ports::{DocumentService, editing::EditingWorkerService},
};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, RequiredPermission, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use permissions_types::share_permission::access_level::AccessLevel;
use std::sync::Arc;

/// Narrow document metadata capability required by spreadsheet workflows.
#[cfg_attr(test, mockall::automock)]
pub trait SpreadsheetDocumentLookup: Send + Sync + 'static {
    /// Return the native file type for the authorized document.
    fn file_type(
        &self,
        document_id: &str,
    ) -> impl std::future::Future<Output = anyhow::Result<Option<String>>> + Send;
}

impl<D: DocumentService> SpreadsheetDocumentLookup for D {
    async fn file_type(&self, document_id: &str) -> anyhow::Result<Option<String>> {
        Ok(self
            .internal_get_basic_document(document_id)
            .await?
            .file_type)
    }
}

/// Why a spreadsheet workflow did not complete.
#[derive(Debug, thiserror::Error)]
pub enum SpreadsheetError {
    /// Access or token minting.
    #[error(transparent)]
    Document(#[from] DocumentError),
    /// The document is not a native Macro spreadsheet.
    #[error(
        "This requires a native Macro spreadsheet. Import an Excel file into a spreadsheet first; read other documents as text."
    )]
    NotSpreadsheet,
    /// The request is invalid, such as an unknown sheet, a bad range or a
    /// failing operation; nothing changed.
    #[error("{0}")]
    Invalid(String),
    /// The workbook changed since the expected revision was read; nothing
    /// changed.
    #[error("{0}")]
    RevisionConflict(String),
    /// The engine failed, so an edit may or may not have been saved.
    #[error(transparent)]
    Failed(anyhow::Error),
}

/// Who a spreadsheet workflow acts for, as named in its document token.
pub enum SpreadsheetCaller<'a> {
    /// An AI agent acting for a user; the token names the agent as the actor.
    Agent {
        /// The user the agent acts for.
        user: &'a MacroUserIdStr<'a>,
        /// The agent's storage id.
        actor: &'a str,
    },
    /// Whoever holds the access receipt: its acting user, with its bot as the
    /// actor.
    Receipt,
}

/// Runs spreadsheet workflows after the caller obtains the required typed receipt.
pub struct SpreadsheetService<D, W> {
    documents: Arc<D>,
    worker: Arc<W>,
    token_secret: String,
}

impl<D: SpreadsheetDocumentLookup, W: EditingWorkerService> SpreadsheetService<D, W> {
    /// Compose the domain service from document and execution ports.
    pub fn new(documents: Arc<D>, worker: Arc<W>, token_secret: String) -> Self {
        Self {
            documents,
            worker,
            token_secret,
        }
    }

    /// Inspect a workbook or evaluate a hypothetical calculation without writes.
    pub async fn read(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        caller: SpreadsheetCaller<'_>,
        request: SpreadsheetRequest,
    ) -> Result<SpreadsheetResponse, SpreadsheetError> {
        if matches!(request, SpreadsheetRequest::Edit { .. }) {
            return Err(SpreadsheetError::Invalid(
                "Editing requires edit access.".to_owned(),
            ));
        }
        self.run(&receipt, caller, AccessLevel::View, request).await
    }

    /// Apply an atomic, revision-guarded edit to a native workbook.
    pub async fn edit(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        caller: SpreadsheetCaller<'_>,
        expected_revision: String,
        operations: Vec<SpreadsheetOperation>,
    ) -> Result<SpreadsheetResponse, SpreadsheetError> {
        if expected_revision.is_empty() {
            return Err(SpreadsheetError::Invalid(
                "Read the spreadsheet first and pass its revision before editing.".to_owned(),
            ));
        }
        if operations.is_empty() || operations.len() > 25 {
            return Err(SpreadsheetError::Invalid(
                "Send between 1 and 25 spreadsheet operations.".to_owned(),
            ));
        }
        self.run(
            &receipt,
            caller,
            AccessLevel::Edit,
            SpreadsheetRequest::Edit {
                expected_revision,
                operations,
            },
        )
        .await
    }

    #[tracing::instrument(
        name = "spreadsheet.run",
        skip_all,
        fields(document_id = %receipt.entity().entity_id, access = ?access),
        err
    )]
    async fn run<Permission: RequiredPermission>(
        &self,
        receipt: &EntityAccessReceipt<Permission>,
        caller: SpreadsheetCaller<'_>,
        access: AccessLevel,
        request: SpreadsheetRequest,
    ) -> Result<SpreadsheetResponse, SpreadsheetError> {
        let document_id = &receipt.entity().entity_id;
        let file_type = self
            .documents
            .file_type(document_id)
            .await
            .map_err(SpreadsheetError::Failed)?;
        if file_type.as_deref() != Some("spreadsheet") {
            return Err(SpreadsheetError::NotSpreadsheet);
        }

        let token = match caller {
            SpreadsheetCaller::Agent { user, actor } => encode_permission_token(
                Some(user.to_string()),
                document_id.clone(),
                access,
                &self.token_secret,
                Some(actor.to_owned()),
            )?,
            SpreadsheetCaller::Receipt => {
                encode_receipt_permission_token(receipt, access, &self.token_secret)?
            }
        };
        self.worker.spreadsheet(document_id, &token, &request).await
    }
}

#[cfg(test)]
mod test;
