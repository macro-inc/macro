//! Edit a native spreadsheet by natural-language instructions: one writer
//! model in the editing worker reads the workbook and commits one batch.

use super::{
    SpreadsheetChange, SpreadsheetDocumentLookup, SpreadsheetError, SpreadsheetSheetSummary,
};
use crate::domain::{
    permission_token::encode_receipt_permission_token,
    ports::editing::{EditUsage, EditingWorkerService},
};
use ai_billing::domain::admission::{AiAdmissionError, AiAdmissionService};
use ai_usage::{AiFeature, UsageAmount, UsageContext, UsageRecorder};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use models_permissions::share_permission::access_level::AccessLevel;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Longest instructions the writer accepts, in bytes.
const MAX_INSTRUCTIONS_BYTES: usize = 20_000;

/// How the editing worker's writer model left the workbook.
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum SpreadsheetWriterOutcome {
    /// One batch was committed.
    #[serde(rename_all = "camelCase")]
    Edited {
        /// Revision after the edit.
        revision: String,
        /// Whether a new change was persisted.
        applied: bool,
        /// Applied operation summaries.
        changes: Vec<SpreadsheetChange>,
        /// Sheet metadata after editing.
        sheets: Vec<SpreadsheetSheetSummary>,
        /// Issues requiring inspection, including formula errors.
        warnings: Vec<String>,
    },
    /// The model could not do the edit; nothing changed.
    Refused {
        /// What it needs, or why it cannot do the edit.
        reason: String,
    },
    /// The edit failed after the model started.
    #[serde(rename_all = "camelCase")]
    Failed {
        /// What went wrong.
        error: String,
        /// The workbook changed while the model worked; nothing was saved.
        conflict: bool,
        /// The commit was sent but not confirmed.
        may_have_saved: bool,
    },
}

/// The writer's outcome and the model usage to bill for it.
pub struct SpreadsheetWriterResult {
    /// How the workbook was left.
    pub outcome: SpreadsheetWriterOutcome,
    /// Tokens per model, billed whatever the outcome.
    pub usage: Vec<EditUsage>,
}

/// A completed edit by instructions.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetAiEdited {
    /// Revision after the edit.
    pub revision: String,
    /// Whether a new change was persisted.
    pub applied: bool,
    /// What changed, one summary per operation.
    pub changes: Vec<SpreadsheetChange>,
    /// Every sheet after the edit.
    pub sheets: Vec<SpreadsheetSheetSummary>,
    /// Issues to check, such as formula errors; they are not repaired.
    pub warnings: Vec<String>,
}

/// Why an edit by instructions did not complete.
#[derive(Debug, thiserror::Error)]
pub enum SpreadsheetAiEditError {
    /// Access, file type, request shape, or a revision conflict.
    #[error(transparent)]
    Spreadsheet(#[from] SpreadsheetError),
    /// AI admission refused the caller; no model ran.
    #[error("{0}")]
    Admission(AiAdmissionError),
    /// The writer could not do the edit and saved nothing.
    #[error("edit refused: {0}")]
    Refused(String),
    /// The edit failed before anything was saved.
    #[error("edit failed before saving: {0}")]
    NotSaved(String),
    /// The edit failed while saving, so it may have been saved.
    #[error("edit outcome unknown: {0}")]
    OutcomeUnknown(anyhow::Error),
}

/// Edits native spreadsheets by instructions, with AI admission and metering.
pub struct SpreadsheetAiEditService<D, W> {
    documents: Arc<D>,
    worker: Arc<W>,
    token_secret: String,
    admission: Arc<dyn AiAdmissionService>,
    recorder: Arc<dyn UsageRecorder>,
}

impl<D: SpreadsheetDocumentLookup, W: EditingWorkerService> SpreadsheetAiEditService<D, W> {
    /// Compose the service from document, worker, admission and metering ports.
    pub fn new(
        documents: Arc<D>,
        worker: Arc<W>,
        token_secret: String,
        admission: Arc<dyn AiAdmissionService>,
        recorder: Arc<dyn UsageRecorder>,
    ) -> Self {
        Self {
            documents,
            worker,
            token_secret,
            admission,
            recorder,
        }
    }

    /// Admit the caller, run the writer model and bill its usage. Dropping
    /// this future drops the worker request, which cancels the edit before
    /// its commit; never detach it.
    #[tracing::instrument(
        name = "spreadsheet.ai_edit",
        skip_all,
        fields(document_id = %receipt.entity().entity_id, instructions_len = instructions.len()),
        err
    )]
    pub async fn edit(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        instructions: &str,
    ) -> Result<SpreadsheetAiEdited, SpreadsheetAiEditError> {
        if instructions.trim().is_empty() || instructions.len() > MAX_INSTRUCTIONS_BYTES {
            return Err(SpreadsheetError::Invalid(
                "Spreadsheet instructions must contain 1–20000 bytes.".to_owned(),
            )
            .into());
        }
        let document_id = &receipt.entity().entity_id;
        let file_type = self
            .documents
            .file_type(document_id)
            .await
            .map_err(SpreadsheetError::Failed)?;
        if file_type.as_deref() != Some("spreadsheet") {
            return Err(SpreadsheetError::NotSpreadsheet.into());
        }
        // Admission and metering bill a user; a bot with no acting user has none.
        let caller = receipt
            .acting_user_id()
            .cloned()
            .ok_or(SpreadsheetError::Document(
                crate::domain::models::DocumentError::Unauthorized,
            ))?;
        self.admission
            .admit(&caller, AiFeature::AiEditing)
            .await
            .map_err(SpreadsheetAiEditError::Admission)?;

        let token =
            encode_receipt_permission_token(&receipt, AccessLevel::Edit, &self.token_secret)
                .map_err(SpreadsheetError::Document)?;
        let result = self
            .worker
            .spreadsheet_instructions(document_id, &token, instructions)
            .await
            .map_err(|error| match error {
                // A broken connection or a server error may follow the save.
                SpreadsheetError::Failed(error) => SpreadsheetAiEditError::OutcomeUnknown(error),
                error => error.into(),
            })?;

        let context = UsageContext::new(AiFeature::AiEditing, caller)
            .with_entity(macro_uuid::string_to_uuid(document_id).ok());
        for usage in result.usage {
            self.recorder.record(context.clone().into_event(
                usage.model,
                UsageAmount::Tokens {
                    input: u64::from(usage.input_tokens),
                    output: u64::from(usage.output_tokens),
                    cache_read: 0,
                    cache_write: 0,
                },
            ));
        }

        match result.outcome {
            SpreadsheetWriterOutcome::Edited {
                revision,
                applied,
                changes,
                sheets,
                warnings,
            } => Ok(SpreadsheetAiEdited {
                revision,
                applied,
                changes,
                sheets,
                warnings,
            }),
            SpreadsheetWriterOutcome::Refused { reason } => {
                Err(SpreadsheetAiEditError::Refused(reason))
            }
            SpreadsheetWriterOutcome::Failed {
                error,
                conflict: true,
                ..
            } => Err(SpreadsheetError::RevisionConflict(error).into()),
            SpreadsheetWriterOutcome::Failed {
                error,
                may_have_saved: true,
                ..
            } => Err(SpreadsheetAiEditError::OutcomeUnknown(anyhow::anyhow!(
                error
            ))),
            SpreadsheetWriterOutcome::Failed { error, .. } => {
                Err(SpreadsheetAiEditError::NotSaved(error))
            }
        }
    }
}
