//! Agent tools that move CRM data through CSV: a companies list into the
//! team CRM, a CSV into a pipeline, and a pipeline out to a CSV file. Each
//! is a thin adapter over [`CrmTransferService`].

mod export_pipeline_csv;
mod import_companies_csv;
mod import_pipeline_csv;

#[cfg(test)]
mod test;

use std::sync::Arc;

use ai_toolset::{AsyncToolCollection, ToolCallError};
use bot_id::BotId;
use databases::domain::models::Viewer;
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::Serialize;
use uuid::Uuid;

use crate::domain::crm_transfer::{
    CrmTransferService, CsvInput, PipelineImportOutcome, SkippedRecord, TransferError,
};

pub use export_pipeline_csv::{ExportPipelineCsv, ExportPipelineCsvResponse};
pub use import_companies_csv::{ImportCompaniesCsv, ImportCompaniesCsvResponse};
pub use import_pipeline_csv::{ImportPipelineCsv, ImportPipelineCsvResponse};

use super::{crm_error_description, pipelines::workflow_error};

/// Most skipped records a response lists; the counts cover the rest.
const LISTED: usize = 50;

/// The transfer service and the agent the tools act as.
pub struct CrmTransferToolContext<Transfer> {
    /// Reads the CSV, matches it to the CRM, and writes through the pipelines.
    pub service: Arc<Transfer>,
    /// The agent acting for the requesting user; attribution only.
    pub actor: BotId,
}

impl<Transfer> Clone for CrmTransferToolContext<Transfer> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            actor: self.actor,
        }
    }
}

impl<Transfer> CrmTransferToolContext<Transfer> {
    /// The requesting user, with this context's agent acting for them.
    fn viewer(&self, user_id: MacroUserIdStr<'static>) -> Viewer {
        Viewer {
            user_id,
            acting_bot: Some(self.actor),
        }
    }
}

/// Every CRM CSV tool.
pub fn crm_transfer_toolset<Transfer: CrmTransferService>()
-> AsyncToolCollection<CrmTransferToolContext<Transfer>> {
    AsyncToolCollection::new()
        .add_tool::<ImportCompaniesCsv, CrmTransferToolContext<Transfer>>()
        .add_tool::<ImportPipelineCsv, CrmTransferToolContext<Transfer>>()
        .add_tool::<ExportPipelineCsv, CrmTransferToolContext<Transfer>>()
}

/// The CSV a tool reads: exactly one of its text or a Macro file.
fn csv_input(csv: &Option<String>, document_id: Option<Uuid>) -> Result<CsvInput, ToolCallError> {
    match (csv, document_id) {
        (Some(text), None) => Ok(CsvInput::Text(text.clone())),
        (None, Some(id)) => Ok(CsvInput::File(id)),
        _ => Err(ToolCallError {
            description: "Give exactly one of csv (the CSV text) or documentId (a CSV file in \
                          Macro)."
                .to_owned(),
            internal_error: anyhow::anyhow!("csv input without exactly one source"),
        }),
    }
}

/// A transfer failure in words the model can act on.
fn transfer_error(error: TransferError) -> ToolCallError {
    let description = match error {
        TransferError::Workflow(error) => return workflow_error(error),
        TransferError::Invalid(ref message) | TransferError::File(ref message) => message.clone(),
        TransferError::Crm(ref error) => crm_error_description(error),
        TransferError::Access(_) => {
            "Access to the CRM could not be checked right now. Retry the call.".to_owned()
        }
    };
    ToolCallError {
        description,
        internal_error: error.into(),
    }
}

/// A record an import could not add.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolSkippedRecord {
    /// The company's domain or the contact's email.
    pub key: String,
    /// Why it was not added.
    pub reason: String,
}

fn listed(records: &[SkippedRecord]) -> Vec<ToolSkippedRecord> {
    records
        .iter()
        .take(LISTED)
        .map(|record| ToolSkippedRecord {
            key: record.key.clone(),
            reason: record.reason.clone(),
        })
        .collect()
}

/// A select field and the options an import added to it.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolAddedOptions {
    /// The field.
    pub field: String,
    /// The labels added.
    pub labels: Vec<String>,
}

/// What a pipeline import did.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolPipelineImport {
    /// The pipeline filled.
    pub pipeline_id: Uuid,
    /// Its name.
    pub pipeline_name: String,
    /// Entries added.
    pub added: usize,
    /// Rows whose record the pipeline already had, so were not added again.
    pub already_present: usize,
    /// Companies or contacts created to add their entries.
    pub created_records: usize,
    /// How many records could not be found or created.
    pub unresolved_count: usize,
    /// The first of them, with why.
    pub unresolved: Vec<ToolSkippedRecord>,
    /// How many rows were refused for a value their field cannot hold.
    pub invalid_count: usize,
    /// The first of them, with why.
    pub invalid: Vec<ToolSkippedRecord>,
    /// Rows without a domain or email.
    pub skipped_rows: usize,
    /// Pipeline fields the CSV filled.
    pub filled_fields: Vec<String>,
    /// CSV columns that match no field the import can fill.
    pub ignored_columns: Vec<String>,
    /// Options added to select fields so the CSV's values fit.
    pub added_options: Vec<ToolAddedOptions>,
}

impl From<&PipelineImportOutcome> for ToolPipelineImport {
    fn from(outcome: &PipelineImportOutcome) -> Self {
        Self {
            pipeline_id: outcome.pipeline_id,
            pipeline_name: outcome.pipeline_name.clone(),
            added: outcome.added,
            already_present: outcome.already_present,
            created_records: outcome.created_records,
            unresolved_count: outcome.unresolved.len(),
            unresolved: listed(&outcome.unresolved),
            invalid_count: outcome.invalid.len(),
            invalid: listed(&outcome.invalid),
            skipped_rows: outcome.skipped_rows,
            filled_fields: outcome.filled_fields.clone(),
            ignored_columns: outcome.ignored_columns.clone(),
            added_options: outcome
                .added_options
                .iter()
                .map(|(field, labels)| ToolAddedOptions {
                    field: field.clone(),
                    labels: labels.clone(),
                })
                .collect(),
        }
    }
}

/// One sentence per part of a pipeline import worth reporting.
fn pipeline_summary(outcome: &PipelineImportOutcome) -> String {
    let mut parts = vec![format!(
        "Added {} entries to \"{}\".",
        outcome.added, outcome.pipeline_name
    )];
    if outcome.already_present > 0 {
        parts.push(format!(
            "{} rows were already in the pipeline, so not added again.",
            outcome.already_present
        ));
    }
    if outcome.created_records > 0 {
        parts.push(format!(
            "Created {} companies or contacts for them.",
            outcome.created_records
        ));
    }
    if !outcome.unresolved.is_empty() {
        parts.push(format!(
            "{} records could not be found or created.",
            outcome.unresolved.len()
        ));
    }
    if !outcome.invalid.is_empty() {
        parts.push(format!(
            "{} rows were refused for values their fields cannot hold.",
            outcome.invalid.len()
        ));
    }
    if !outcome.ignored_columns.is_empty() {
        parts.push(format!(
            "Columns with no matching field were skipped: {}.",
            outcome.ignored_columns.join(", ")
        ));
    }
    for (field, labels) in &outcome.added_options {
        parts.push(format!("Added {field} options: {}.", labels.join(", ")));
    }
    parts.join(" ")
}
