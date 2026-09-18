//! Permission-scoped spreadsheet workflows and their transport-independent commands.

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
        user: &MacroUserIdStr<'_>,
        actor: &str,
        request: SpreadsheetRequest,
    ) -> anyhow::Result<SpreadsheetResponse> {
        anyhow::ensure!(
            !matches!(request, SpreadsheetRequest::Edit { .. }),
            "Editing requires edit access."
        );
        self.run(
            &receipt.entity().entity_id,
            user,
            actor,
            AccessLevel::View,
            request,
        )
        .await
    }

    /// Apply an atomic, revision-guarded edit to a native workbook.
    pub async fn edit(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        user: &MacroUserIdStr<'_>,
        actor: &str,
        expected_revision: String,
        operations: Vec<SpreadsheetOperation>,
    ) -> anyhow::Result<SpreadsheetResponse> {
        anyhow::ensure!(
            !expected_revision.is_empty(),
            "ReadSpreadsheet first and pass its revision before editing."
        );
        anyhow::ensure!(
            !operations.is_empty() && operations.len() <= 25,
            "Send between 1 and 25 spreadsheet operations."
        );
        self.run(
            &receipt.entity().entity_id,
            user,
            actor,
            AccessLevel::Edit,
            SpreadsheetRequest::Edit {
                expected_revision,
                operations,
            },
        )
        .await
    }

    async fn run(
        &self,
        document_id: &str,
        user: &MacroUserIdStr<'_>,
        actor: &str,
        access: AccessLevel,
        request: SpreadsheetRequest,
    ) -> anyhow::Result<SpreadsheetResponse> {
        let file_type = self.documents.file_type(document_id).await?;
        anyhow::ensure!(
            file_type.as_deref() == Some("spreadsheet"),
            "This tool requires a native Macro spreadsheet. Import an Excel file into a spreadsheet first; use ReadContent for other documents."
        );
        let token = encode_permission_token(
            Some(user.to_string()),
            document_id.to_owned(),
            access,
            &self.token_secret,
            Some(actor.to_owned()),
        )?;
        self.worker.spreadsheet(document_id, &token, &request).await
    }
}

#[cfg(test)]
mod test;
