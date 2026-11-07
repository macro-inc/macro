//! What CSV imports and exports take and return, and the ports they use.

use databases::domain::models::Viewer;
use entity_access::domain::models::AccessError;
use uuid::Uuid;

use super::super::{
    crm_csv::CsvError, model::CrmError, pipeline_workflows::WorkflowError,
    pipelines::PipelineSharing,
};

/// Where an import reads its CSV from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CsvInput {
    /// The CSV text itself.
    Text(String),
    /// A CSV file in Macro the viewer can open.
    File(Uuid),
}

/// The pipeline a companies import puts Stage, Owner and Revenue into.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PipelineDestination {
    /// An existing company pipeline the viewer can edit.
    Existing(Uuid),
    /// A new company pipeline; unnamed, it is named after the file.
    New {
        /// Its name.
        name: Option<String>,
        /// Whether the team may edit it.
        sharing: PipelineSharing,
    },
}

/// A record an import could not add, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedRecord {
    /// The company's domain or the contact's email.
    pub key: String,
    /// What went wrong, in words the user can act on.
    pub reason: String,
}

/// What a companies import did.
#[derive(Debug, Clone, PartialEq)]
pub struct CompanyImportOutcome {
    /// Companies created.
    pub created: usize,
    /// Companies the team already had.
    pub existing: usize,
    /// Rows without a domain like acme.com.
    pub skipped_rows: usize,
    /// Companies that could not be created.
    pub failed: Vec<SkippedRecord>,
    /// The pipeline entries made from Stage, Owner and Revenue, when the
    /// CSV had any.
    pub pipeline: Option<PipelineImportOutcome>,
}

/// What a pipeline import did.
#[derive(Debug, Clone, PartialEq)]
pub struct PipelineImportOutcome {
    /// The pipeline filled.
    pub pipeline_id: Uuid,
    /// Its name.
    pub pipeline_name: String,
    /// Entries added.
    pub added: usize,
    /// Rows whose record the pipeline already had before the import.
    pub already_present: usize,
    /// Companies or contacts the import created to add their entries.
    pub created_records: usize,
    /// Records that could not be found or created.
    pub unresolved: Vec<SkippedRecord>,
    /// Rows refused for a value their field cannot hold.
    pub invalid: Vec<SkippedRecord>,
    /// Rows without a domain or email.
    pub skipped_rows: usize,
    /// Pipeline fields the CSV filled.
    pub filled_fields: Vec<String>,
    /// CSV columns that match no field the import can fill.
    pub ignored_columns: Vec<String>,
    /// Options added to select fields so the CSV's values fit: field, labels.
    pub added_options: Vec<(String, Vec<String>)>,
}

/// A pipeline saved as a CSV file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PipelineExport {
    /// The CSV file in Macro.
    pub document_id: Uuid,
    /// The file's name.
    pub file_name: String,
    /// Entries written.
    pub rows: usize,
    /// Whether every entry was written; a pipeline beyond the read limit
    /// is cut there.
    pub complete: bool,
}

/// A CSV file read from Macro.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CsvFile {
    /// The file's name, without its extension.
    pub name: String,
    /// Its text.
    pub text: String,
}

/// What creating a company or contact did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Created {
    /// The new record's id.
    New(Uuid),
    /// The team already has it, where the viewer cannot see it.
    Exists,
    /// The CRM refused it; the reason says why.
    Refused(String),
}

/// Why an import or export did not run.
#[derive(Debug, thiserror::Error)]
pub enum TransferError {
    /// The request or its CSV is unusable; the message says what to change.
    #[error("{0}")]
    Invalid(String),
    /// A CSV file could not be read or saved; the message says why.
    #[error("{0}")]
    File(String),
    /// A pipeline workflow refused or failed.
    #[error(transparent)]
    Workflow(#[from] WorkflowError),
    /// A CRM read or write failed.
    #[error(transparent)]
    Crm(#[from] CrmError),
    /// Access could not be established.
    #[error(transparent)]
    Access(#[from] AccessError),
}

impl From<CsvError> for TransferError {
    fn from(error: CsvError) -> Self {
        match error {
            CsvError::Invalid(message) => Self::Invalid(message),
        }
    }
}

/// Finds and creates the companies and contacts an import names, as the
/// viewer.
pub trait TransferRecords: Send + Sync + 'static {
    /// Every company id the viewer's team CRM tracks, by each of its domains.
    fn company_domains(
        &self,
        viewer: &Viewer,
    ) -> impl Future<Output = Result<std::collections::HashMap<String, Uuid>, TransferError>> + Send;

    /// Create a company named `name` for `domain`.
    fn create_company(
        &self,
        viewer: &Viewer,
        name: &str,
        domain: &str,
    ) -> impl Future<Output = Result<Created, TransferError>> + Send;

    /// The id of the team's contact with `email`.
    fn contact(
        &self,
        viewer: &Viewer,
        email: &str,
    ) -> impl Future<Output = Result<Option<Uuid>, TransferError>> + Send;

    /// Create a contact named `name` with `email` under `company`.
    fn create_contact(
        &self,
        viewer: &Viewer,
        company: Uuid,
        name: &str,
        email: &str,
    ) -> impl Future<Output = Result<Created, TransferError>> + Send;
}

/// Reads and saves CSV files in Macro, as the viewer.
pub trait CsvFiles: Send + Sync + 'static {
    /// The CSV file `document` the viewer can open.
    fn read(
        &self,
        viewer: &Viewer,
        document: Uuid,
    ) -> impl Future<Output = Result<CsvFile, TransferError>> + Send;

    /// Save `text` as a CSV file named `name` in the viewer's files.
    fn save(
        &self,
        viewer: &Viewer,
        name: &str,
        text: String,
    ) -> impl Future<Output = Result<Uuid, TransferError>> + Send;
}
