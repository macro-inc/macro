//! Request and response bodies of the pipeline workflow routes: entries by
//! the record they track, fields by name, options by label.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    crm_transfer::{
        CompanyImportOutcome, PipelineCsv, PipelineExport, PipelineImportOutcome, SkippedRecord,
    },
    pipeline_workflows::{
        FieldChange, FieldInput, FieldKind, FieldValue, FoundEntries, NewField, NewFieldKind,
        NewPipeline, OptionCounts, PipelineEntryView, PipelineField, PipelineOverview,
        PipelineRecord, RecordEntries, UpdatedEntry,
    },
    pipelines::{AccessiblePipeline, PipelineRecordType, PipelineSharing},
};

/// A field and the text to write into it or match it against. Leave out both
/// `value` and `values` to empty the field, or in a filter to match an empty
/// field.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldValueInput {
    /// The field's name, ignoring case.
    pub field: String,
    /// One value: an option label, a person as "me", an email or a macro|
    /// user id, a number, true/false, or a date.
    #[serde(default)]
    pub value: Option<String>,
    /// Several values, for a field holding several. A filter matches an entry
    /// holding any of them.
    #[serde(default)]
    pub values: Option<Vec<String>>,
}

impl FieldValueInput {
    fn pair(&self) -> (String, FieldInput) {
        let input = match (&self.values, &self.value) {
            (Some(values), _) if !values.is_empty() => FieldInput::Many(values.clone()),
            (_, Some(value)) => FieldInput::One(value.clone()),
            _ => FieldInput::Clear,
        };
        (self.field.clone(), input)
    }
}

/// Each field name paired with what to write or match.
pub(super) fn pairs(values: &[FieldValueInput]) -> Vec<(String, FieldInput)> {
    values.iter().map(FieldValueInput::pair).collect()
}

/// A stored value in its field's own terms.
#[derive(Debug, Clone, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum EntryFieldValue {
    /// Free text.
    Text(String),
    /// A number.
    Number(f64),
    /// True or false.
    Checkbox(bool),
    /// A date-time.
    Date(DateTime<Utc>),
    /// A span of time, written start/end: 2026-10-12/2026-10-16.
    DateRange(String),
    /// Option labels, in the cell's order.
    Labels(Vec<String>),
    /// URLs.
    Links(Vec<String>),
    /// Macro ids: people as macro| user ids, records or other items.
    References(Vec<String>),
}

impl From<&FieldValue> for EntryFieldValue {
    fn from(value: &FieldValue) -> Self {
        match value {
            FieldValue::Text(text) => Self::Text(text.clone()),
            FieldValue::Number(number) => Self::Number(*number),
            FieldValue::Checkbox(checked) => Self::Checkbox(*checked),
            FieldValue::Date(date) => Self::Date(*date),
            FieldValue::DateRange(range) => Self::DateRange(range.iso()),
            FieldValue::Labels(labels) => Self::Labels(labels.clone()),
            FieldValue::Links(links) => Self::Links(links.clone()),
            FieldValue::References(ids) => Self::References(ids.clone()),
        }
    }
}

/// The company or contact an entry tracks.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntryRecord {
    /// The CRM company or contact id.
    pub id: Uuid,
    /// Its name; missing when the caller cannot see the record.
    pub name: Option<String>,
    /// A company's domain or a contact's email.
    pub detail: Option<String>,
}

impl From<&PipelineRecord> for EntryRecord {
    fn from(record: &PipelineRecord) -> Self {
        Self {
            id: record.id,
            name: record.name.clone(),
            detail: record.detail.clone(),
        }
    }
}

/// One pipeline entry.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineEntry {
    /// The entry: a row of the pipeline's table.
    pub entry_id: Uuid,
    /// The company or contact it tracks; missing in a generic pipeline.
    pub record: Option<EntryRecord>,
    /// Its other fields that hold a value, by name.
    pub fields: BTreeMap<String, EntryFieldValue>,
}

impl From<&PipelineEntryView> for PipelineEntry {
    fn from(entry: &PipelineEntryView) -> Self {
        Self {
            entry_id: entry.entry_id.into_uuid(),
            record: entry.record.as_ref().map(EntryRecord::from),
            fields: entry
                .fields
                .iter()
                .map(|(name, value)| (name.clone(), value.into()))
                .collect(),
        }
    }
}

/// What a field holds.
#[derive(Debug, Clone, Copy, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PipelineFieldType {
    /// The company the entry tracks.
    Company,
    /// The contact the entry tracks.
    Contact,
    /// Free text.
    Text,
    /// A number.
    Number,
    /// True or false.
    Checkbox,
    /// A date-time.
    Date,
    /// A span of time, written start/end: 2026-10-12/2026-10-16.
    DateRange,
    /// URLs.
    Link,
    /// Labels from `options`, such as a stage.
    Select,
    /// Tags.
    Tags,
    /// Macro users.
    Person,
    /// Ids of other Macro items.
    Item,
    /// Linked rows; written only in the app.
    Relation,
    /// Computed; never written.
    Formula,
}

impl From<FieldKind> for PipelineFieldType {
    fn from(kind: FieldKind) -> Self {
        match kind {
            FieldKind::Record(PipelineRecordType::Company) => Self::Company,
            FieldKind::Record(PipelineRecordType::Contact) => Self::Contact,
            FieldKind::Text => Self::Text,
            FieldKind::Number => Self::Number,
            FieldKind::Checkbox => Self::Checkbox,
            FieldKind::Date => Self::Date,
            FieldKind::DateRange => Self::DateRange,
            FieldKind::Link => Self::Link,
            FieldKind::Select => Self::Select,
            FieldKind::Tags => Self::Tags,
            FieldKind::Person => Self::Person,
            FieldKind::Entity(_) => Self::Item,
            FieldKind::Relation => Self::Relation,
            FieldKind::Formula => Self::Formula,
        }
    }
}

/// One field of a pipeline, named as people see it.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineFieldSummary {
    /// The name entries and filters use.
    pub name: String,
    /// What it holds.
    #[serde(rename = "type")]
    pub field_type: PipelineFieldType,
    /// Whether it holds several values.
    pub multiple: bool,
    /// A select or tags field's labels in order: for Stage, the stages from
    /// first to last.
    pub options: Vec<String>,
    /// Whether every entry must have a value.
    pub required: bool,
    /// Whether the caller cannot write it.
    pub read_only: bool,
    /// For a monetary amount, the field holding each entry's currency code.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency_field: Option<String>,
}

impl PipelineFieldSummary {
    fn for_pipeline(field: &PipelineField, overview: &PipelineOverview) -> Self {
        Self {
            name: field.name.clone(),
            field_type: field.kind.into(),
            multiple: field.multiple,
            options: field
                .options
                .iter()
                .map(|(_, label)| label.clone())
                .collect(),
            required: overview.requires(field),
            read_only: !field.writable,
            currency_field: overview
                .currency_field(field)
                .map(|currency| currency.name.clone()),
        }
    }
}

/// A pipeline with its fields.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineFields {
    /// The pipeline and the caller's grant on it.
    #[serde(flatten)]
    pub pipeline: AccessiblePipeline,
    /// Its fields in column order; a tracked pipeline's first names its record.
    pub fields: Vec<PipelineFieldSummary>,
    /// Its table's version when read.
    pub version: i64,
}

impl From<&PipelineOverview> for PipelineFields {
    fn from(overview: &PipelineOverview) -> Self {
        Self {
            pipeline: overview.pipeline.clone(),
            fields: overview
                .fields
                .iter()
                .map(|field| PipelineFieldSummary::for_pipeline(field, overview))
                .collect(),
            version: overview.version.0,
        }
    }
}

/// Which entries to read, and how to order them.
#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FindEntriesRequest {
    /// Every filter must match.
    #[serde(default)]
    pub filters: Vec<FieldValueInput>,
    /// Only entries tracking one of these companies or contacts.
    #[serde(default)]
    pub record_ids: Vec<Uuid>,
    /// Text the record's name, domain or email must contain.
    #[serde(default)]
    pub search: Option<String>,
    /// The field to order by; number, date and select fields order by value
    /// and stage order.
    #[serde(default)]
    pub sort_by: Option<String>,
    /// Put the largest first.
    #[serde(default)]
    pub descending: bool,
    /// Most entries to return, 1 to 5000; defaults to 50. Counts and totals
    /// cover every match regardless.
    #[serde(default)]
    pub limit: Option<usize>,
}

/// How many matched entries hold one option.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OptionCount {
    /// The option's label.
    pub label: String,
    /// Matched entries holding it.
    pub count: usize,
}

/// Matched entries per option of one single-select field, such as Stage.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FieldOptionCounts {
    /// The field.
    pub field: String,
    /// Every option in order, with its count.
    pub counts: Vec<OptionCount>,
    /// Matched entries with the field empty.
    pub empty: usize,
}

impl From<&OptionCounts> for FieldOptionCounts {
    fn from(counts: &OptionCounts) -> Self {
        Self {
            field: counts.field.clone(),
            counts: counts
                .counts
                .iter()
                .map(|(label, count)| OptionCount {
                    label: label.clone(),
                    count: *count,
                })
                .collect(),
            empty: counts.empty,
        }
    }
}

/// The sum of a number field over the matched entries.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FieldTotal {
    /// The field.
    pub field: String,
    /// The currency code of a monetary field's amounts; such a field has one
    /// total per currency, never converted or combined. Absent for other numbers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// The sum.
    pub sum: f64,
}

/// The entries a query matched.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FoundEntriesResponse {
    /// The pipeline read, with its fields and version.
    pub pipeline: PipelineFields,
    /// The first `limit` matches, in the requested order.
    pub entries: Vec<PipelineEntry>,
    /// How many entries matched in all.
    pub matched: usize,
    /// Whether every entry was read; a pipeline beyond 5000 entries is not,
    /// so counts and totals cover only the entries read.
    pub complete: bool,
    /// Matched entries per option of each single-select field.
    pub counts: Vec<FieldOptionCounts>,
    /// The sum of each number field over the matched entries.
    pub totals: Vec<FieldTotal>,
}

impl From<&FoundEntries> for FoundEntriesResponse {
    fn from(found: &FoundEntries) -> Self {
        Self {
            pipeline: (&found.pipeline).into(),
            entries: found.entries.iter().map(PipelineEntry::from).collect(),
            matched: found.matched,
            complete: found.complete,
            counts: found.counts.iter().map(FieldOptionCounts::from).collect(),
            totals: found
                .totals
                .iter()
                .map(|total| FieldTotal {
                    field: total.field.clone(),
                    currency: total.currency.clone(),
                    sum: total.sum,
                })
                .collect(),
        }
    }
}

/// The companies or contacts to find entries for, across pipelines.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordEntriesRequest {
    /// CRM company or contact ids.
    pub record_ids: Vec<Uuid>,
}

/// Text to find entries by, across pipelines.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct EntrySearchQuery {
    /// Text the record's name, domain or email must contain.
    pub search: String,
    /// Most entries per pipeline, 1 to 5000; defaults to 50.
    pub limit: Option<usize>,
}

/// A pipeline's entries among those asked for.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineEntries {
    /// The pipeline.
    pub pipeline: AccessiblePipeline,
    /// Its matching entries.
    pub entries: Vec<PipelineEntry>,
}

impl From<&RecordEntries> for PipelineEntries {
    fn from(group: &RecordEntries) -> Self {
        Self {
            pipeline: group.pipeline.clone(),
            entries: group.entries.iter().map(PipelineEntry::from).collect(),
        }
    }
}

/// One entry to add: at most one of `recordId` or `email`. A tracked
/// pipeline's entry names its record; a generic pipeline's names none.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewEntry {
    /// A CRM company or contact id.
    #[serde(default)]
    pub record_id: Option<Uuid>,
    /// A contact's email: that contact, or in a company pipeline its company.
    #[serde(default)]
    pub email: Option<String>,
    /// Fields to fill in.
    #[serde(default)]
    pub set: Vec<FieldValueInput>,
}

/// Entries to add.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddEntriesRequest {
    /// The records to add, each with its starting fields.
    pub entries: Vec<NewEntry>,
    /// Add a record again although it already has an entry here.
    #[serde(default)]
    pub allow_duplicates: bool,
}

/// The entries added.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddEntriesResponse {
    /// The new entries, as saved.
    pub added: Vec<PipelineEntry>,
    /// Existing entries of requested records that were not added again.
    pub already_present: Vec<PipelineEntry>,
    /// The table's version after the write; missing when nothing was written.
    pub version: Option<i64>,
}

/// The changes to one entry: exactly one of `entryId` or `recordId`.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntryChanges {
    /// The entry.
    #[serde(default)]
    pub entry_id: Option<Uuid>,
    /// The record whose single entry in the pipeline to change.
    #[serde(default)]
    pub record_id: Option<Uuid>,
    /// Fields to set.
    pub set: Vec<FieldValueInput>,
}

/// Entries to change.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateEntriesRequest {
    /// Each entry's changes.
    pub updates: Vec<EntryChanges>,
    /// Refuse the change if the pipeline's table moved past this version.
    #[serde(default)]
    pub base_version: Option<i64>,
}

/// One field's value before and after an update.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntryFieldChange {
    /// The field.
    pub field: String,
    /// Its value before; missing when it was empty.
    pub before: Option<EntryFieldValue>,
    /// Its value now; missing when it is empty.
    pub after: Option<EntryFieldValue>,
}

impl From<&FieldChange> for EntryFieldChange {
    fn from(change: &FieldChange) -> Self {
        Self {
            field: change.field.clone(),
            before: change.before.as_ref().map(EntryFieldValue::from),
            after: change.after.as_ref().map(EntryFieldValue::from),
        }
    }
}

/// An updated entry.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedPipelineEntry {
    /// The entry.
    pub entry_id: Uuid,
    /// The company or contact it tracks; missing in a generic pipeline.
    pub record: Option<EntryRecord>,
    /// The fields set, as they were and are.
    pub changes: Vec<EntryFieldChange>,
}

impl From<&UpdatedEntry> for UpdatedPipelineEntry {
    fn from(entry: &UpdatedEntry) -> Self {
        Self {
            entry_id: entry.entry_id.into_uuid(),
            record: entry.record.as_ref().map(EntryRecord::from),
            changes: entry.changes.iter().map(EntryFieldChange::from).collect(),
        }
    }
}

/// The entries an update wrote.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEntriesResponse {
    /// Each entry, in request order.
    pub updated: Vec<UpdatedPipelineEntry>,
    /// The table's version after the write; missing when nothing was written.
    pub version: Option<i64>,
}

/// Entries to delete; their companies and contacts stay in the CRM.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoveEntriesRequest {
    /// Entries to delete.
    #[serde(default)]
    pub entry_ids: Vec<Uuid>,
    /// Records whose every entry in the pipeline to delete.
    #[serde(default)]
    pub record_ids: Vec<Uuid>,
}

/// The entries deleted.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoveEntriesResponse {
    /// Each entry as it was.
    pub removed: Vec<PipelineEntry>,
    /// The table's version after the write; missing when nothing was written.
    pub version: Option<i64>,
}

/// The type of a field to add.
#[derive(Debug, Clone, Copy, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NewFieldType {
    /// Free text.
    Text,
    /// A number.
    Number,
    /// True or false.
    Checkbox,
    /// A date.
    Date,
    /// URLs.
    Link,
    /// One label from `options`.
    Select,
    /// Several labels from `options`.
    MultiSelect,
    /// One Macro user.
    Person,
    /// Several Macro users.
    People,
}

impl From<NewFieldType> for NewFieldKind {
    fn from(value: NewFieldType) -> Self {
        match value {
            NewFieldType::Text => Self::Text,
            NewFieldType::Number => Self::Number,
            NewFieldType::Checkbox => Self::Checkbox,
            NewFieldType::Date => Self::Date,
            NewFieldType::Link => Self::Link,
            NewFieldType::Select => Self::Select,
            NewFieldType::MultiSelect => Self::MultiSelect,
            NewFieldType::Person => Self::Person,
            NewFieldType::People => Self::People,
        }
    }
}

/// A new pipeline with its stages and fields.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreatePipelineRequest {
    /// Its name.
    pub name: String,
    /// Company or contact entries; omitted, a generic pipeline of free-form rows.
    #[serde(default)]
    pub record_type: Option<PipelineRecordType>,
    /// Defaults to private.
    #[serde(default)]
    pub sharing: PipelineSharing,
    /// Its stages, first to last, replacing the team's default stages. A
    /// generic pipeline starts without a Stage field, so these add one.
    #[serde(default)]
    pub stages: Vec<String>,
    /// Fields to add after the standard ones, or after a generic pipeline's Name.
    #[serde(default)]
    pub fields: Vec<NewFieldRequest>,
}

impl From<CreatePipelineRequest> for NewPipeline {
    fn from(request: CreatePipelineRequest) -> Self {
        Self {
            name: request.name,
            record_type: request.record_type,
            sharing: request.sharing,
            stages: request.stages,
            fields: request.fields.iter().map(Into::into).collect(),
        }
    }
}

/// A field to add.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewFieldRequest {
    /// Its name, unique in the pipeline ignoring case.
    pub name: String,
    /// Its type.
    #[serde(rename = "type")]
    pub field_type: NewFieldType,
    /// A select field's labels, in order.
    #[serde(default)]
    pub options: Vec<String>,
}

impl From<&NewFieldRequest> for NewField {
    fn from(field: &NewFieldRequest) -> Self {
        Self {
            name: field.name.clone(),
            kind: field.field_type.into(),
            options: field.options.clone(),
        }
    }
}

/// A field to rename.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldRename {
    /// Its current name.
    pub from: String,
    /// Its new name.
    pub to: String,
}

/// Labels to add to a select field.
#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldOptions {
    /// The field.
    pub field: String,
    /// The labels.
    pub labels: Vec<String>,
}

/// An option to relabel.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OptionRename {
    /// The field.
    pub field: String,
    /// The current label.
    pub from: String,
    /// The new label.
    pub to: String,
}

/// An option to delete, emptying the entries holding it.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OptionRemoval {
    /// The field.
    pub field: String,
    /// The label.
    pub label: String,
}

/// Changes to a pipeline's name, sharing, fields and options, applied
/// together.
#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditPipelineRequest {
    /// A new name.
    #[serde(default)]
    pub name: Option<String>,
    /// New team sharing; only the owner may change it.
    #[serde(default)]
    pub sharing: Option<PipelineSharing>,
    /// Fields to add.
    #[serde(default)]
    pub add_fields: Vec<NewFieldRequest>,
    /// Fields to rename.
    #[serde(default)]
    pub rename_fields: Vec<FieldRename>,
    /// Fields to delete with their values.
    #[serde(default)]
    pub remove_fields: Vec<String>,
    /// Labels to add to select fields; for Stage, new stages go last.
    #[serde(default)]
    pub add_options: Vec<FieldOptions>,
    /// Options to relabel.
    #[serde(default)]
    pub rename_options: Vec<OptionRename>,
    /// Options to delete.
    #[serde(default)]
    pub remove_options: Vec<OptionRemoval>,
}

/// A CSV to import: exactly one of its text or a CSV file in Macro.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportPipelineCsvRequest {
    /// The CSV text.
    #[serde(default)]
    pub csv: Option<String>,
    /// A CSV document the caller can open.
    #[serde(default)]
    pub document_id: Option<Uuid>,
}

/// A record an import could not add, and why.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SkippedImportRecord {
    /// The company's domain or the contact's email.
    pub key: String,
    /// What went wrong.
    pub reason: String,
}

impl From<&SkippedRecord> for SkippedImportRecord {
    fn from(record: &SkippedRecord) -> Self {
        Self {
            key: record.key.clone(),
            reason: record.reason.clone(),
        }
    }
}

fn skipped(records: &[SkippedRecord]) -> Vec<SkippedImportRecord> {
    records.iter().map(SkippedImportRecord::from).collect()
}

/// What a pipeline import did.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineImportResponse {
    /// The pipeline filled.
    pub pipeline_id: Uuid,
    /// Its name.
    pub pipeline_name: String,
    /// Entries added.
    pub added: usize,
    /// Rows whose record the pipeline already had.
    pub already_present: usize,
    /// Companies or contacts the import created.
    pub created_records: usize,
    /// Records that could not be found or created.
    pub unresolved: Vec<SkippedImportRecord>,
    /// Rows refused for a value their field cannot hold.
    pub invalid: Vec<SkippedImportRecord>,
    /// Rows without a domain or email.
    pub skipped_rows: usize,
    /// Pipeline fields the CSV filled.
    pub filled_fields: Vec<String>,
    /// CSV columns matching no field the import can fill.
    pub ignored_columns: Vec<String>,
    /// Labels added to select fields so the CSV's values fit.
    pub added_options: Vec<FieldOptions>,
}

impl From<&PipelineImportOutcome> for PipelineImportResponse {
    fn from(outcome: &PipelineImportOutcome) -> Self {
        Self {
            pipeline_id: outcome.pipeline_id,
            pipeline_name: outcome.pipeline_name.clone(),
            added: outcome.added,
            already_present: outcome.already_present,
            created_records: outcome.created_records,
            unresolved: skipped(&outcome.unresolved),
            invalid: skipped(&outcome.invalid),
            skipped_rows: outcome.skipped_rows,
            filled_fields: outcome.filled_fields.clone(),
            ignored_columns: outcome.ignored_columns.clone(),
            added_options: outcome
                .added_options
                .iter()
                .map(|(field, labels)| FieldOptions {
                    field: field.clone(),
                    labels: labels.clone(),
                })
                .collect(),
        }
    }
}

/// A new company pipeline for a companies import.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewImportPipeline {
    /// Its name; defaults to the file's name.
    #[serde(default)]
    pub name: Option<String>,
    /// Whether the team may edit it; private by default.
    #[serde(default)]
    pub sharing: PipelineSharing,
}

/// A companies CSV to import: exactly one of its text or a CSV file in
/// Macro, and at most one of `pipelineId` or `newPipeline` for its Stage,
/// Owner and Revenue values (a new private pipeline when neither is given).
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportCompaniesCsvRequest {
    /// The CSV text.
    #[serde(default)]
    pub csv: Option<String>,
    /// A CSV document the caller can open.
    #[serde(default)]
    pub document_id: Option<Uuid>,
    /// An existing company pipeline the caller can edit.
    #[serde(default)]
    pub pipeline_id: Option<Uuid>,
    /// A new company pipeline.
    #[serde(default)]
    pub new_pipeline: Option<NewImportPipeline>,
}

/// What a companies import did.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompanyImportResponse {
    /// Companies created.
    pub created: usize,
    /// Companies the team already had.
    pub existing: usize,
    /// Rows without a domain like acme.com.
    pub skipped_rows: usize,
    /// Companies that could not be created.
    pub failed: Vec<SkippedImportRecord>,
    /// The entries made from Stage, Owner and Revenue, when the CSV had any.
    pub pipeline: Option<PipelineImportResponse>,
}

impl From<&CompanyImportOutcome> for CompanyImportResponse {
    fn from(outcome: &CompanyImportOutcome) -> Self {
        Self {
            created: outcome.created,
            existing: outcome.existing,
            skipped_rows: outcome.skipped_rows,
            failed: skipped(&outcome.failed),
            pipeline: outcome.pipeline.as_ref().map(PipelineImportResponse::from),
        }
    }
}

/// A pipeline's entries as CSV text: Company and Domain (or Contact and
/// Email), then one column per field, people as emails.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineCsvResponse {
    /// The pipeline's name.
    pub name: String,
    /// The CSV.
    pub csv: String,
    /// Entries written.
    pub rows: usize,
    /// Whether every entry was written; a pipeline beyond 5000 entries is cut.
    pub complete: bool,
}

impl From<PipelineCsv> for PipelineCsvResponse {
    fn from(csv: PipelineCsv) -> Self {
        Self {
            name: csv.name,
            csv: csv.text,
            rows: csv.rows,
            complete: csv.complete,
        }
    }
}

/// A pipeline saved as a CSV file in the caller's files.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PipelineExportResponse {
    /// The CSV document.
    pub document_id: Uuid,
    /// Its name.
    pub file_name: String,
    /// Entries written.
    pub rows: usize,
    /// Whether every entry was written; a pipeline beyond 5000 entries is cut.
    pub complete: bool,
}

impl From<PipelineExport> for PipelineExportResponse {
    fn from(export: PipelineExport) -> Self {
        Self {
            document_id: export.document_id,
            file_name: export.file_name,
            rows: export.rows,
            complete: export.complete,
        }
    }
}
