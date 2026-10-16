//! What the pipeline workflows take and return.

use databases::domain::models::{RowId, TableDetail, TableVersion};
use entity_access::domain::models::AccessError;
use models_databases::EntityKind;
use uuid::Uuid;

use super::super::{
    model::CrmError,
    pipelines::{AccessiblePipeline, PipelineError, PipelineRecordType, PipelineSharing},
};
use super::{FieldInput, FieldValue, NewFieldKind, PipelineField, PipelineRecord};

/// Most rows a read scans; a larger pipeline is reported as incomplete.
pub const MAX_SCANNED_ROWS: usize = 5_000;

/// A pipeline with its fields in column order.
#[derive(Debug, Clone)]
pub struct PipelineOverview {
    /// The pipeline and the viewer's grant on it.
    pub pipeline: AccessiblePipeline,
    /// Its fields, the record field first.
    pub fields: Vec<PipelineField>,
    /// Its table's version when it was read.
    pub version: TableVersion,
}

impl PipelineOverview {
    pub(super) fn new(pipeline: AccessiblePipeline, table: TableDetail) -> Self {
        Self {
            fields: table
                .columns
                .iter()
                .map(|column| PipelineField::new(column, &pipeline.pipeline))
                .collect(),
            version: table.table.version,
            pipeline,
        }
    }

    /// The field named `name`, ignoring case.
    pub fn field(&self, name: &str) -> Result<&PipelineField, WorkflowError> {
        let name = name.trim();
        self.fields
            .iter()
            .find(|field| field.name.eq_ignore_ascii_case(name))
            .ok_or_else(|| {
                let names: Vec<&str> = self.fields.iter().map(|f| f.name.as_str()).collect();
                WorkflowError::Invalid(format!(
                    "Pipeline \"{}\" has no field \"{name}\". Its fields are: {}.",
                    self.pipeline.pipeline.name,
                    names.join(", ")
                ))
            })
    }

    pub(super) fn record_field(&self) -> &PipelineField {
        self.fields
            .iter()
            .find(|field| field.is_record())
            .expect("a pipeline's table has its record column")
    }

    pub(super) fn record_kind(&self) -> EntityKind {
        match self.pipeline.pipeline.record_type {
            PipelineRecordType::Company => EntityKind::Company,
            PipelineRecordType::Contact => EntityKind::Contact,
        }
    }
}

/// One entry: the record it tracks and its filled-in fields.
#[derive(Debug, Clone, PartialEq)]
pub struct PipelineEntryView {
    /// The entry, a row of the pipeline.
    pub entry_id: RowId,
    /// The company or contact it tracks.
    pub record: PipelineRecord,
    /// Its other fields that hold a value, in column order.
    pub fields: Vec<(String, FieldValue)>,
}

/// Which entries to read, and how to order them.
#[derive(Debug, Clone, Default)]
pub struct EntryQuery {
    /// Field name and the value (or any of several values) it must hold.
    pub filters: Vec<(String, FieldInput)>,
    /// Only entries tracking one of these records.
    pub records: Vec<Uuid>,
    /// Text the record's name, domain or email must contain.
    pub search: Option<String>,
    /// The field to order by, and whether to put the largest first.
    pub sort: Option<(String, bool)>,
    /// Most entries to return.
    pub limit: usize,
}

/// How many matched entries hold each option of a single-select field.
#[derive(Debug, Clone, PartialEq)]
pub struct OptionCounts {
    /// The field.
    pub field: String,
    /// Each option in the field's order, with its count.
    pub counts: Vec<(String, usize)>,
    /// Entries with no option.
    pub empty: usize,
}

/// The entries a query matched.
#[derive(Debug, Clone)]
pub struct FoundEntries {
    /// The pipeline read.
    pub pipeline: PipelineOverview,
    /// The first `limit` matches, in the requested order.
    pub entries: Vec<PipelineEntryView>,
    /// How many entries matched in all.
    pub matched: usize,
    /// Whether every entry was read; a pipeline beyond [`MAX_SCANNED_ROWS`]
    /// is not, so counts and totals cover only the rows read.
    pub complete: bool,
    /// Matched entries per option of each single-select field.
    pub counts: Vec<OptionCounts>,
    /// Sum of each number field over the matched entries.
    pub totals: Vec<(String, f64)>,
}

/// A record's entries in one pipeline.
#[derive(Debug, Clone)]
pub struct RecordEntries {
    /// The pipeline.
    pub pipeline: AccessiblePipeline,
    /// The entries tracking the records asked about.
    pub entries: Vec<PipelineEntryView>,
}

/// A company or contact to add, by id or by a contact's email address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordTarget {
    /// A CRM company or contact id.
    Id(Uuid),
    /// A contact's email: that contact, or in a company pipeline its company.
    Email(String),
}

/// One entry to add.
#[derive(Debug, Clone)]
pub struct EntryAddition {
    /// The record it tracks.
    pub record: RecordTarget,
    /// Fields to fill in, by name.
    pub set: Vec<(String, FieldInput)>,
}

/// Entries to change: one by its id, or every entry tracking a record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryTarget {
    /// One entry.
    Entry(RowId),
    /// The entries tracking this company or contact.
    Record(Uuid),
}

/// Fields to change on one entry.
#[derive(Debug, Clone)]
pub struct EntryUpdate {
    /// The entry; a record must have exactly one entry in the pipeline.
    pub target: EntryTarget,
    /// Fields to set, by name.
    pub set: Vec<(String, FieldInput)>,
}

/// Entries added, and requested records already in the pipeline.
#[derive(Debug, Clone)]
pub struct AddedEntries {
    /// The new entries.
    pub added: Vec<PipelineEntryView>,
    /// Existing entries of records that were not added again.
    pub already_present: Vec<PipelineEntryView>,
    /// The table's version after the write.
    pub version: Option<TableVersion>,
}

/// One field's value before and after an update.
#[derive(Debug, Clone, PartialEq)]
pub struct FieldChange {
    /// The field.
    pub field: String,
    /// Its value before.
    pub before: Option<FieldValue>,
    /// Its value after.
    pub after: Option<FieldValue>,
}

/// An updated entry.
#[derive(Debug, Clone)]
pub struct UpdatedEntry {
    /// The entry.
    pub entry_id: RowId,
    /// The record it tracks.
    pub record: PipelineRecord,
    /// The fields set, as they were and are.
    pub changes: Vec<FieldChange>,
}

/// The entries an update wrote.
#[derive(Debug, Clone)]
pub struct UpdatedEntries {
    /// Each entry, in request order.
    pub updated: Vec<UpdatedEntry>,
    /// The table's version after the write.
    pub version: Option<TableVersion>,
}

/// The entries a removal deleted.
#[derive(Debug, Clone)]
pub struct RemovedEntries {
    /// Each entry as it was.
    pub removed: Vec<PipelineEntryView>,
    /// The table's version after the write.
    pub version: Option<TableVersion>,
}

/// A field to add to a pipeline.
#[derive(Debug, Clone)]
pub struct NewField {
    /// Its name, unique in the pipeline ignoring case.
    pub name: String,
    /// Its type.
    pub kind: NewFieldKind,
    /// A select field's options, in order.
    pub options: Vec<String>,
}

/// A pipeline to create.
#[derive(Debug, Clone)]
pub struct NewPipeline {
    /// Its name.
    pub name: String,
    /// Whether entries track companies or contacts.
    pub record_type: PipelineRecordType,
    /// Whether the team may edit it.
    pub sharing: PipelineSharing,
    /// Its stages in order, replacing the team's default stages.
    pub stages: Vec<String>,
    /// Fields to add after the standard ones.
    pub fields: Vec<NewField>,
}

/// Changes to a pipeline's name, sharing and fields.
#[derive(Debug, Clone, Default)]
pub struct PipelineEdit {
    /// A new name.
    pub name: Option<String>,
    /// New team sharing; only the owner may change it.
    pub sharing: Option<PipelineSharing>,
    /// Fields to add.
    pub add_fields: Vec<NewField>,
    /// Fields to rename: current name, new name.
    pub rename_fields: Vec<(String, String)>,
    /// Fields to delete with their values.
    pub remove_fields: Vec<String>,
    /// Options to add to select fields: field, labels.
    pub add_options: Vec<(String, Vec<String>)>,
    /// Options to relabel: field, current label, new label.
    pub rename_options: Vec<(String, String, String)>,
    /// Options to delete, emptying the entries holding them: field, label.
    pub remove_options: Vec<(String, String)>,
}

/// Why a workflow did not run.
#[derive(Debug, thiserror::Error)]
pub enum WorkflowError {
    /// The request names something the pipeline does not have, or asks for
    /// what it cannot do; the message says what to change.
    #[error("{0}")]
    Invalid(String),
    /// The user belongs to no team, so has no CRM.
    #[error("the user is not in a team, so they have no CRM")]
    NoTeam,
    /// The pipeline refused or failed.
    #[error(transparent)]
    Pipeline(#[from] PipelineError),
    /// Reading CRM records failed.
    #[error(transparent)]
    Crm(#[from] CrmError),
    /// Access could not be established.
    #[error(transparent)]
    Access(#[from] AccessError),
}
