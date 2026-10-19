//! CSV import and export for agents: a companies list into the team CRM
//! (with its Stage, Owner and Revenue on pipeline entries), a CSV into a
//! pipeline, and a pipeline out to a CSV file.
//!
//! Every write goes through [`PipelineWorkflowService`] and the CRM's own
//! record creation, so imports keep the same access, validation and field
//! rules as the single-record tools; this module only reads the CSV, matches
//! its columns, and batches the writes.

mod models;
mod records;

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, PoisonError};

use databases::domain::models::Viewer;
use futures::{StreamExt, stream};
use uuid::Uuid;

use super::{
    crm_csv::{
        CsvTable, RecordRow, company_pipeline_rows, encode_csv, parse_csv, record_rows,
        unique_companies,
    },
    pipeline_workflows::{
        EntryAddition, EntryQuery, FieldInput, FieldKind, FieldValue, MAX_SCANNED_ROWS,
        NewPipeline, PipelineEdit, PipelineField, PipelineOverview, PipelineWorkflowService,
        RecordTarget, WorkflowError,
    },
    pipelines::{PipelineRecordType, PipelineSharing},
};

pub use models::{
    CompanyImportOutcome, Created, CsvFile, CsvFiles, CsvInput, PipelineDestination,
    PipelineExport, PipelineImportOutcome, SkippedRecord, TransferError, TransferRecords,
};
pub use records::CrmTransferRecords;

/// Records created at once; enough for thousands of rows, gentle on the CRM.
const CONCURRENCY: usize = 4;
/// Entries written per pipeline write.
const BATCH: usize = 500;
/// A record's id and whether the import created it, or why it has none.
type Found = Result<(Uuid, bool), String>;

/// The name of a pipeline made for a companies CSV given as text.
const DEFAULT_PIPELINE_NAME: &str = "Imported companies";

/// CSV imports and exports for a viewer, who may be an agent acting for a user.
pub trait CrmTransferService: Send + Sync + 'static {
    /// Create the companies a CSV lists, then put its Stage, Owner and
    /// Revenue values on entries of `destination`: by default a new private
    /// pipeline, made only when the CSV has such values.
    fn import_companies(
        &self,
        viewer: &Viewer,
        csv: CsvInput,
        destination: Option<PipelineDestination>,
    ) -> impl Future<Output = Result<CompanyImportOutcome, TransferError>> + Send;

    /// Add a CSV's rows to a pipeline as entries, creating the companies or
    /// contacts the team lacks. Records the pipeline already had are not
    /// added again; repeated rows for a new record add separate entries.
    fn import_to_pipeline(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        csv: CsvInput,
    ) -> impl Future<Output = Result<PipelineImportOutcome, TransferError>> + Send;

    /// Save every entry of a pipeline as a CSV file in the viewer's files.
    fn export_pipeline(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
    ) -> impl Future<Output = Result<PipelineExport, TransferError>> + Send;
}

/// [`CrmTransferService`] over the pipeline workflows, the CRM's records and
/// Macro's files.
pub struct CrmTransferServiceImpl<Workflows, Records, Files> {
    workflows: Arc<Workflows>,
    records: Records,
    files: Files,
}

impl<Workflows, Records, Files> CrmTransferServiceImpl<Workflows, Records, Files> {
    /// Imports and exports through these services.
    pub fn new(workflows: Arc<Workflows>, records: Records, files: Files) -> Self {
        Self {
            workflows,
            records,
            files,
        }
    }
}

/// Run `futures` at most [`CONCURRENCY`] at a time. Built eagerly by the
/// caller (they do nothing until polled), so no closure here borrows across
/// the await.
async fn bounded<F: Future>(futures: Vec<F>) -> Vec<F::Output> {
    stream::iter(futures)
        .buffer_unordered(CONCURRENCY)
        .collect()
        .await
}

/// The domain of an email address.
fn email_domain(email: &str) -> Option<&str> {
    email.split_once('@').map(|(_, domain)| domain)
}

/// The headers that name a record, so are never matched to a field.
fn record_headers(record_type: PipelineRecordType) -> [&'static str; 2] {
    match record_type {
        PipelineRecordType::Company => ["Company", "Domain"],
        PipelineRecordType::Contact => ["Contact", "Email"],
    }
}

/// Fields an import can fill from text: stored values that carry across
/// teams. References to records and other items hold ids another workspace
/// would not have.
fn importable(field: &PipelineField) -> bool {
    field.writable
        && matches!(
            field.kind,
            FieldKind::Text
                | FieldKind::Number
                | FieldKind::Checkbox
                | FieldKind::Date
                | FieldKind::Link
                | FieldKind::Select
                | FieldKind::Tags
                | FieldKind::Person
        )
}

/// A cell's value as the CSV writes it, so an import reads it back.
fn exported_value(value: &FieldValue) -> String {
    match value {
        FieldValue::Text(text) => text.clone(),
        FieldValue::Number(number) if number.fract() == 0.0 && number.abs() < 1e15 => {
            format!("{number:.0}")
        }
        FieldValue::Number(number) => number.to_string(),
        FieldValue::Checkbox(checked) => checked.to_string(),
        FieldValue::Date(date) => date.to_rfc3339(),
        FieldValue::Labels(values) | FieldValue::Links(values) => values.join(", "),
        // People leave as emails, which another team can match.
        FieldValue::References(ids) => ids
            .iter()
            .map(|id| id.strip_prefix("macro|").unwrap_or(id))
            .collect::<Vec<_>>()
            .join(", "),
    }
}

/// What a row writes into `field`; several values only for a field that holds several.
fn field_input(field: &PipelineField, value: &str) -> FieldInput {
    if field.multiple {
        FieldInput::Many(
            value
                .split(',')
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .map(str::to_owned)
                .collect(),
        )
    } else {
        FieldInput::One(value.to_owned())
    }
}

/// Labels the rows name that a select field lacks, per field, first spelling kept.
fn missing_options(
    fields: &[(String, &PipelineField)],
    rows: &[RecordRow],
) -> Vec<(String, Vec<String>)> {
    fields
        .iter()
        .filter(|(_, field)| matches!(field.kind, FieldKind::Select | FieldKind::Tags))
        .filter_map(|(header, field)| {
            let mut known: HashSet<String> = field
                .options
                .iter()
                .map(|(_, label)| label.to_lowercase())
                .collect();
            let mut added = Vec::new();
            for row in rows {
                let Some((_, value)) = row.values.iter().find(|(h, _)| h == header) else {
                    continue;
                };
                let labels = match field_input(field, value) {
                    FieldInput::Many(labels) => labels,
                    FieldInput::One(label) => vec![label],
                    FieldInput::Clear => Vec::new(),
                };
                for label in labels {
                    if known.insert(label.to_lowercase()) {
                        added.push(label);
                    }
                }
            }
            (!added.is_empty()).then(|| (field.name.clone(), added))
        })
        .collect()
}

impl<Workflows, Records, Files> CrmTransferServiceImpl<Workflows, Records, Files>
where
    Workflows: PipelineWorkflowService,
    Records: TransferRecords,
    Files: CsvFiles,
{
    async fn read(
        &self,
        viewer: &Viewer,
        csv: CsvInput,
    ) -> Result<(CsvTable, Option<String>), TransferError> {
        match csv {
            CsvInput::Text(text) => Ok((parse_csv(&text)?, None)),
            CsvInput::File(document) => {
                let file = self.files.read(viewer, document).await?;
                Ok((parse_csv(&file.text)?, Some(file.name)))
            }
        }
    }

    async fn pipeline(&self, viewer: &Viewer, id: Uuid) -> Result<PipelineOverview, TransferError> {
        self.workflows
            .pipelines(viewer)
            .await?
            .into_iter()
            .find(|overview| overview.pipeline.pipeline.id == id)
            .ok_or_else(|| {
                TransferError::Invalid(format!(
                    "{id} is not a pipeline the user can open. Find pipeline ids with ListPipelines."
                ))
            })
    }

    /// The company for `domain`, created as `name` when the team lacks it.
    async fn company(
        &self,
        viewer: &Viewer,
        domains: &SharedDomains,
        name: &str,
        domain: &str,
    ) -> Result<Found, TransferError> {
        if let Some(id) = domains.get(domain) {
            return Ok(Ok((id, false)));
        }
        Ok(
            match self.records.create_company(viewer, name, domain).await? {
                Created::New(id) => {
                    domains.insert(domain, id);
                    Ok((id, true))
                }
                Created::Exists => {
                    Err("the team already tracks this domain on a hidden company".into())
                }
                Created::Refused(reason) => Err(reason),
            },
        )
    }

    /// The record each row names, by key, creating the ones the team lacks.
    async fn resolve(
        &self,
        viewer: &Viewer,
        record_type: PipelineRecordType,
        rows: &[RecordRow],
        domains: &SharedDomains,
    ) -> Result<(HashMap<String, Uuid>, usize, Vec<SkippedRecord>), TransferError> {
        let mut seen = HashSet::new();
        let unique: Vec<&RecordRow> = rows
            .iter()
            .filter(|row| seen.insert(row.key.as_str()))
            .collect();
        let found = match record_type {
            PipelineRecordType::Company => self.companies(viewer, &unique, domains).await?,
            PipelineRecordType::Contact => self.contacts(viewer, &unique, domains).await?,
        };
        let mut ids = HashMap::new();
        let mut created = 0;
        let mut unresolved = Vec::new();
        for (key, result) in found {
            match result {
                Ok((id, new)) => {
                    created += usize::from(new);
                    ids.insert(key, id);
                }
                Err(reason) => unresolved.push(SkippedRecord { key, reason }),
            }
        }
        unresolved.sort_by(|a, b| a.key.cmp(&b.key));
        Ok((ids, created, unresolved))
    }

    /// Each row's company, created when the team lacks it. Rows name
    /// distinct domains, so concurrent creations never race on one.
    async fn companies(
        &self,
        viewer: &Viewer,
        rows: &[&RecordRow],
        domains: &SharedDomains,
    ) -> Result<Vec<(String, Found)>, TransferError> {
        let found = bounded(
            rows.iter()
                .map(|row| async move {
                    let found = self.company(viewer, domains, &row.name, &row.key).await?;
                    Ok::<_, TransferError>((row.key.clone(), found))
                })
                .collect(),
        )
        .await;
        found.into_iter().collect()
    }

    /// Each row's contact: found by email, or created under its domain's
    /// company. Missing companies are created first, once per domain, so
    /// contacts at one new domain share it.
    async fn contacts(
        &self,
        viewer: &Viewer,
        rows: &[&RecordRow],
        domains: &SharedDomains,
    ) -> Result<Vec<(String, Found)>, TransferError> {
        let lookups = bounded(
            rows.iter()
                .map(|row| async move {
                    let id = self.records.contact(viewer, &row.key).await?;
                    Ok::<_, TransferError>((*row, id))
                })
                .collect(),
        )
        .await
        .into_iter()
        .collect::<Result<Vec<(&RecordRow, Option<Uuid>)>, _>>()?;

        let mut new_domains: Vec<String> = lookups
            .iter()
            .filter(|(_, id)| id.is_none())
            .filter_map(|(row, _)| email_domain(&row.key).map(str::to_owned))
            .filter(|domain| domains.get(domain).is_none())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        new_domains.sort();
        let mut refused = HashMap::new();
        for result in bounded(
            new_domains
                .iter()
                .map(|domain| async move {
                    let found = self.company(viewer, domains, domain, domain).await?;
                    Ok::<_, TransferError>((domain.clone(), found.err()))
                })
                .collect(),
        )
        .await
        {
            if let (domain, Some(reason)) = result? {
                refused.insert(domain, reason);
            }
        }

        let refused = &refused;
        let found = bounded(
            lookups
                .iter()
                .map(|&(row, existing)| async move {
                    if let Some(id) = existing {
                        return Ok((row.key.clone(), Ok((id, false))));
                    }
                    let domain = email_domain(&row.key).unwrap_or_default();
                    let Some(company) = domains.get(domain) else {
                        let reason = refused
                            .get(domain)
                            .map_or("it could not be created", String::as_str);
                        return Ok((
                            row.key.clone(),
                            Err(format!("its company could not be added: {reason}")),
                        ));
                    };
                    let found = match self
                        .records
                        .create_contact(viewer, company, &row.name, &row.key)
                        .await?
                    {
                        Created::New(id) => Ok((id, true)),
                        Created::Exists => {
                            Err("the contact exists where the user cannot see it".into())
                        }
                        Created::Refused(reason) => Err(reason),
                    };
                    Ok::<_, TransferError>((row.key.clone(), found))
                })
                .collect(),
        )
        .await;
        found.into_iter().collect()
    }

    /// Add `rows` to `overview`'s pipeline: the shared half of both imports.
    async fn fill(
        &self,
        viewer: &Viewer,
        overview: &PipelineOverview,
        rows: &[RecordRow],
        other_headers: &[String],
        skipped_rows: usize,
        domains: &SharedDomains,
    ) -> Result<PipelineImportOutcome, TransferError> {
        let pipeline = &overview.pipeline.pipeline;
        let record_type = pipeline.record_type;
        let reserved = record_headers(record_type);
        let mut fields: Vec<(String, &PipelineField)> = Vec::new();
        let mut ignored_columns = Vec::new();
        for header in other_headers {
            if reserved
                .iter()
                .any(|name| name.eq_ignore_ascii_case(header))
            {
                continue;
            }
            match overview.fields.iter().find(|field| {
                !field.is_record() && importable(field) && field.name.eq_ignore_ascii_case(header)
            }) {
                Some(field) => fields.push((header.clone(), field)),
                None => ignored_columns.push(header.clone()),
            }
        }

        let (ids, created_records, unresolved) =
            self.resolve(viewer, record_type, rows, domains).await?;
        let record_ids: Vec<Uuid> = ids
            .values()
            .copied()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let present: HashSet<Uuid> = if record_ids.is_empty() {
            HashSet::new()
        } else {
            self.workflows
                .record_entries(viewer, &record_ids)
                .await?
                .into_iter()
                .filter(|found| found.pipeline.pipeline.id == pipeline.id)
                .flat_map(|found| found.entries.into_iter().map(|entry| entry.record.id))
                .collect()
        };

        let mut already_present = 0;
        let mut additions = Vec::new();
        let mut keys = Vec::new();
        let mut new_rows = Vec::new();
        for row in rows {
            let Some(&id) = ids.get(&row.key) else {
                continue;
            };
            if present.contains(&id) {
                already_present += 1;
                continue;
            }
            let set = fields
                .iter()
                .filter_map(|(header, field)| {
                    row.values
                        .iter()
                        .find(|(h, _)| h == header)
                        .map(|(_, value)| (field.name.clone(), field_input(field, value)))
                })
                .collect();
            additions.push(EntryAddition {
                record: RecordTarget::Id(id),
                set,
            });
            keys.push(row.key.clone());
            new_rows.push(row.clone());
        }

        let added_options = missing_options(&fields, &new_rows);
        if !added_options.is_empty() {
            self.workflows
                .edit(
                    viewer,
                    pipeline.id,
                    PipelineEdit {
                        add_options: added_options.clone(),
                        ..PipelineEdit::default()
                    },
                )
                .await?;
        }

        let (added, invalid) = self.add(viewer, pipeline.id, additions, keys).await?;
        Ok(PipelineImportOutcome {
            pipeline_id: pipeline.id,
            pipeline_name: pipeline.name.clone(),
            added,
            already_present,
            created_records,
            unresolved,
            invalid,
            skipped_rows,
            filled_fields: fields.iter().map(|(_, field)| field.name.clone()).collect(),
            ignored_columns,
            added_options,
        })
    }

    /// Write `additions` in batches. A batch refused for a bad value is
    /// retried row by row, so one bad row never costs the others.
    async fn add(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        additions: Vec<EntryAddition>,
        keys: Vec<String>,
    ) -> Result<(usize, Vec<SkippedRecord>), TransferError> {
        let mut added = 0;
        let mut invalid = Vec::new();
        for (batch, batch_keys) in additions.chunks(BATCH).zip(keys.chunks(BATCH)) {
            match self
                .workflows
                .add(viewer, pipeline, batch.to_vec(), true)
                .await
            {
                Ok(result) => added += result.added.len(),
                Err(WorkflowError::Invalid(_)) => {
                    for (addition, key) in batch.iter().zip(batch_keys) {
                        match self
                            .workflows
                            .add(viewer, pipeline, vec![addition.clone()], true)
                            .await
                        {
                            Ok(result) => added += result.added.len(),
                            Err(WorkflowError::Invalid(reason)) => invalid.push(SkippedRecord {
                                key: key.clone(),
                                reason,
                            }),
                            Err(error) => return Err(error.into()),
                        }
                    }
                }
                Err(error) => return Err(error.into()),
            }
        }
        Ok((added, invalid))
    }
}

impl<Workflows, Records, Files> CrmTransferService
    for CrmTransferServiceImpl<Workflows, Records, Files>
where
    Workflows: PipelineWorkflowService,
    Records: TransferRecords,
    Files: CsvFiles,
{
    #[tracing::instrument(skip_all, err)]
    async fn import_companies(
        &self,
        viewer: &Viewer,
        csv: CsvInput,
        destination: Option<PipelineDestination>,
    ) -> Result<CompanyImportOutcome, TransferError> {
        let (table, file_name) = self.read(viewer, csv).await?;
        let parsed = record_rows(&table, PipelineRecordType::Company)?;
        if parsed.rows.is_empty() {
            return Err(TransferError::Invalid(
                "No rows have a domain like acme.com.".into(),
            ));
        }
        tracing::info!(rows = parsed.rows.len(), "importing companies");
        let domains = SharedDomains::new(self.records.company_domains(viewer).await?);
        let companies = unique_companies(&parsed.rows);
        let results = self.companies(viewer, &companies, &domains).await?;
        let mut created = 0;
        let mut existing = 0;
        let mut failed = Vec::new();
        for result in results {
            match result {
                (_, Ok((_, true))) => created += 1,
                (_, Ok((_, false))) => existing += 1,
                (key, Err(reason)) => failed.push(SkippedRecord { key, reason }),
            }
        }
        failed.sort_by(|a, b| a.key.cmp(&b.key));

        let pipeline_rows = company_pipeline_rows(&parsed.rows);
        let pipeline = if pipeline_rows.is_empty() {
            None
        } else {
            let overview = match destination.unwrap_or(PipelineDestination::New {
                name: None,
                sharing: PipelineSharing::Private,
            }) {
                PipelineDestination::Existing(id) => {
                    let overview = self.pipeline(viewer, id).await?;
                    if overview.pipeline.pipeline.record_type != PipelineRecordType::Company {
                        return Err(TransferError::Invalid(format!(
                            "\"{}\" tracks contacts; choose a company pipeline for Stage, Owner and Revenue.",
                            overview.pipeline.pipeline.name
                        )));
                    }
                    overview
                }
                PipelineDestination::New { name, sharing } => {
                    self.workflows
                        .create(
                            viewer,
                            NewPipeline {
                                name: name
                                    .or(file_name)
                                    .filter(|name| !name.trim().is_empty())
                                    .unwrap_or_else(|| DEFAULT_PIPELINE_NAME.to_owned()),
                                record_type: PipelineRecordType::Company,
                                sharing,
                                stages: Vec::new(),
                                fields: Vec::new(),
                            },
                        )
                        .await?
                }
            };
            // Only the pipeline columns some row fills.
            let headers: Vec<String> = parsed
                .other_headers
                .iter()
                .filter(|header| {
                    pipeline_rows
                        .iter()
                        .any(|row| row.values.iter().any(|(h, _)| h == *header))
                })
                .cloned()
                .collect();
            Some(
                self.fill(viewer, &overview, &pipeline_rows, &headers, 0, &domains)
                    .await?,
            )
        };
        Ok(CompanyImportOutcome {
            created,
            existing,
            skipped_rows: parsed.skipped,
            failed,
            pipeline,
        })
    }

    #[tracing::instrument(skip_all, fields(pipeline = %pipeline), err)]
    async fn import_to_pipeline(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        csv: CsvInput,
    ) -> Result<PipelineImportOutcome, TransferError> {
        let overview = self.pipeline(viewer, pipeline).await?;
        let (table, _) = self.read(viewer, csv).await?;
        let parsed = record_rows(&table, overview.pipeline.pipeline.record_type)?;
        if parsed.rows.is_empty() {
            return Err(TransferError::Invalid(
                "No rows name a company by domain or a contact by email.".into(),
            ));
        }
        tracing::info!(rows = parsed.rows.len(), "importing pipeline entries");
        let domains = SharedDomains::new(self.records.company_domains(viewer).await?);
        self.fill(
            viewer,
            &overview,
            &parsed.rows,
            &parsed.other_headers,
            parsed.skipped,
            &domains,
        )
        .await
    }

    #[tracing::instrument(skip_all, fields(pipeline = %pipeline), err)]
    async fn export_pipeline(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
    ) -> Result<PipelineExport, TransferError> {
        let found = self
            .workflows
            .find(
                viewer,
                pipeline,
                EntryQuery {
                    limit: MAX_SCANNED_ROWS,
                    ..EntryQuery::default()
                },
            )
            .await?;
        let overview = &found.pipeline;
        let fields: Vec<&PipelineField> = overview
            .fields
            .iter()
            .filter(|field| !field.is_record())
            .collect();
        let headers: Vec<String> = record_headers(overview.pipeline.pipeline.record_type)
            .iter()
            .map(|header| (*header).to_owned())
            .chain(fields.iter().map(|field| field.name.clone()))
            .collect();
        let rows: Vec<Vec<String>> = found
            .entries
            .iter()
            .map(|entry| {
                [
                    entry.record.name.clone().unwrap_or_default(),
                    entry.record.detail.clone().unwrap_or_default(),
                ]
                .into_iter()
                .chain(fields.iter().map(|field| {
                    entry
                        .fields
                        .iter()
                        .find(|(name, _)| name == &field.name)
                        .map(|(_, value)| exported_value(value))
                        .unwrap_or_default()
                }))
                .collect()
            })
            .collect();
        let file_name = overview.pipeline.pipeline.name.clone();
        let document_id = self
            .files
            .save(viewer, &file_name, encode_csv(&headers, &rows))
            .await?;
        Ok(PipelineExport {
            document_id,
            file_name,
            rows: rows.len(),
            complete: found.complete,
        })
    }
}

/// Company ids by domain, shared by the concurrent creations of one import
/// so a company created for one row is found by the rows after it.
struct SharedDomains(Mutex<HashMap<String, Uuid>>);

impl SharedDomains {
    fn new(domains: HashMap<String, Uuid>) -> Self {
        Self(Mutex::new(domains))
    }

    fn get(&self, domain: &str) -> Option<Uuid> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(domain)
            .copied()
    }

    fn insert(&self, domain: &str, id: Uuid) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(domain.to_owned(), id);
    }
}
