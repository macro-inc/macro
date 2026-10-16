//! Pipeline use cases addressed the way people talk about a pipeline: entries
//! by the company or contact they track, fields by name, stages by label.
//!
//! Each workflow resolves those names against the pipeline's current schema,
//! then reads and writes through [`PipelineService`], so the pipeline's
//! access, policy and the shared database operations stay the only path to
//! its storage.

mod entries;
mod fields;
mod models;
mod ops;
mod records;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use databases::domain::{
    models::{OpBatch, RowId, TableVersion, Viewer},
    storage::{StorageRow, StorageRowsQuery},
};
use entity_access::domain::{
    models::{
        AccessError, EditAccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType,
        MemberTeamRole, OwnerAccessLevel, RequiredPermission, ViewAccessLevel,
    },
    ports::EntityAccessService,
};
use models_databases::{
    CellValue, CellWrite, ColumnChange, DatabaseOp, EntityRef, OpResult, RowChange, RowChanges,
    RowsChange, RowsResult,
};
use uuid::Uuid;

use super::{
    auth::CrmTeamReceipt,
    pipelines::{CreatePipeline, PipelineRecordType, PipelineService},
    service::CrmService,
};

pub use fields::{FieldInput, FieldKind, FieldValue, NewFieldKind, PipelineField};
pub use models::{
    AddedEntries, EntryAddition, EntryQuery, EntryTarget, EntryUpdate, FieldChange, FoundEntries,
    MAX_SCANNED_ROWS, NewField, NewPipeline, OptionCounts, PipelineEdit, PipelineEntryView,
    PipelineOverview, RecordEntries, RecordTarget, RemovedEntries, UpdatedEntries, UpdatedEntry,
    WorkflowError,
};
pub use records::PipelineRecord;

use entries::{entry_view, field_values, option_counts, record_id, totals, value_of};
use ops::{STAGE_FIELD, add_field, add_options, cells, select_field};

/// Pipeline workflows for a viewer, who may be an agent acting for a user.
pub trait PipelineWorkflowService: Send + Sync + 'static {
    /// The viewer's live pipelines with their fields.
    fn pipelines(
        &self,
        viewer: &Viewer,
    ) -> impl Future<Output = Result<Vec<PipelineOverview>, WorkflowError>> + Send;

    /// Entries of one pipeline matching `query`.
    fn find(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        query: EntryQuery,
    ) -> impl Future<Output = Result<FoundEntries, WorkflowError>> + Send;

    /// Entries of every pipeline the viewer can see whose company or contact
    /// matches `search`, at most `limit` per pipeline; pipelines without a
    /// match are left out.
    fn search_entries(
        &self,
        viewer: &Viewer,
        search: &str,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<RecordEntries>, WorkflowError>> + Send;

    /// Every entry tracking one of `records`, across the viewer's pipelines.
    fn record_entries(
        &self,
        viewer: &Viewer,
        records: &[Uuid],
    ) -> impl Future<Output = Result<Vec<RecordEntries>, WorkflowError>> + Send;

    /// Add entries; a record already in the pipeline is added again only
    /// when `allow_duplicates`.
    fn add(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        additions: Vec<EntryAddition>,
        allow_duplicates: bool,
    ) -> impl Future<Output = Result<AddedEntries, WorkflowError>> + Send;

    /// Set fields of entries, refused if the table moved past `base_version`.
    fn update(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        updates: Vec<EntryUpdate>,
        base_version: Option<TableVersion>,
    ) -> impl Future<Output = Result<UpdatedEntries, WorkflowError>> + Send;

    /// Delete entries; their companies and contacts stay in the CRM.
    fn remove(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        targets: Vec<EntryTarget>,
    ) -> impl Future<Output = Result<RemovedEntries, WorkflowError>> + Send;

    /// Create a pipeline, then set its stages and add its fields.
    fn create(
        &self,
        viewer: &Viewer,
        input: NewPipeline,
    ) -> impl Future<Output = Result<PipelineOverview, WorkflowError>> + Send;

    /// Rename, share, or change the fields of a pipeline.
    fn edit(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        edit: PipelineEdit,
    ) -> impl Future<Output = Result<PipelineOverview, WorkflowError>> + Send;
}

/// [`PipelineWorkflowService`] over the pipeline and CRM services.
pub struct PipelineWorkflowServiceImpl<Pipelines, Crm, Access> {
    pipelines: Arc<Pipelines>,
    crm: Arc<Crm>,
    access: Arc<Access>,
}

impl<Pipelines, Crm, Access> PipelineWorkflowServiceImpl<Pipelines, Crm, Access> {
    /// Compose the workflows from the services they run through.
    pub fn new(pipelines: Arc<Pipelines>, crm: Arc<Crm>, access: Arc<Access>) -> Self {
        Self {
            pipelines,
            crm,
            access,
        }
    }
}

impl<Pipelines, Crm, Access> PipelineWorkflowServiceImpl<Pipelines, Crm, Access>
where
    Pipelines: PipelineService,
    Crm: CrmService,
    Access: EntityAccessService,
{
    async fn receipt<T: RequiredPermission>(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
    ) -> Result<EntityAccessReceipt<T>, WorkflowError> {
        Ok(self
            .access
            .generate_entity_access_receipt::<T>(
                &viewer.user_id,
                None,
                &pipeline.to_string(),
                EntityType::CrmPipeline,
            )
            .await?)
    }

    /// The viewer's team CRM, `None` for a user in no team.
    async fn team(
        &self,
        viewer: &Viewer,
    ) -> Result<Option<CrmTeamReceipt<MemberTeamRole>>, WorkflowError> {
        let Some(team) = self.access.get_user_team(&viewer.user_id).await? else {
            return Ok(None);
        };
        let receipt = EntityAccessReceipt::try_new_authenticated_user(
            viewer.user_id.clone(),
            Entity {
                entity_id: team.team_id.to_string(),
                entity_type: EntityType::Team,
            },
            EntityPermission::TeamRole { role: team.role },
        )?;
        Ok(Some(CrmTeamReceipt::from_team_receipt(receipt)?))
    }

    async fn overview(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<PipelineOverview, WorkflowError> {
        let pipeline = self.pipelines.get(receipt.clone()).await?;
        let table = self.pipelines.table(receipt.clone()).await?;
        Ok(PipelineOverview::new(pipeline, table))
    }

    /// The records `rows` track, named as the viewer sees them.
    async fn records(
        &self,
        viewer: &Viewer,
        team: Option<&CrmTeamReceipt<MemberTeamRole>>,
        overview: &PipelineOverview,
        rows: &[&StorageRow],
    ) -> Result<HashMap<Uuid, PipelineRecord>, WorkflowError> {
        let record_field = overview.record_field();
        let ids: Vec<Uuid> = rows
            .iter()
            .filter_map(|row| record_id(row.cells.get(&record_field.id)))
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        Ok(records::records(
            self.crm.as_ref(),
            team,
            viewer.user_id.as_ref(),
            overview.pipeline.pipeline.record_type,
            &ids,
        )
        .await?)
    }

    /// The entries `targets` name: an entry must be this pipeline's, a
    /// record must have one entry when `one_per_record`.
    async fn target_rows(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
        overview: &PipelineOverview,
        targets: &[EntryTarget],
        one_per_record: bool,
    ) -> Result<Vec<Vec<RowId>>, WorkflowError> {
        let name = &overview.pipeline.pipeline.name;
        let records: Vec<Uuid> = targets
            .iter()
            .filter_map(|target| match target {
                EntryTarget::Record(id) => Some(*id),
                EntryTarget::Entry(_) => None,
            })
            .collect();
        let mut by_record: HashMap<Uuid, Vec<RowId>> = HashMap::new();
        for reference in self
            .pipelines
            .record_rows(receipt.clone(), &records)
            .await?
        {
            by_record
                .entry(reference.record_id)
                .or_default()
                .push(reference.row_id);
        }
        let entries: Vec<RowId> = targets
            .iter()
            .filter_map(|target| match target {
                EntryTarget::Entry(id) => Some(*id),
                EntryTarget::Record(_) => None,
            })
            .collect();
        let existing: HashSet<RowId> = if entries.is_empty() {
            HashSet::new()
        } else {
            self.pipelines
                .read_rows(receipt.clone(), &entries)
                .await?
                .into_iter()
                .map(|row| row.row_id)
                .collect()
        };
        targets
            .iter()
            .map(|target| match target {
                EntryTarget::Entry(id) if existing.contains(id) => Ok(vec![*id]),
                EntryTarget::Entry(id) => Err(WorkflowError::Invalid(format!(
                    "Pipeline \"{name}\" has no entry {id}. Find entry ids with FindPipelineEntries."
                ))),
                EntryTarget::Record(id) => match by_record.remove(id) {
                    None => Err(WorkflowError::Invalid(format!(
                        "Record {id} has no entry in pipeline \"{name}\". Add it with AddToPipeline."
                    ))),
                    Some(rows) if one_per_record && rows.len() > 1 => {
                        let ids: Vec<String> = rows.iter().map(ToString::to_string).collect();
                        Err(WorkflowError::Invalid(format!(
                            "Record {id} has {} entries in pipeline \"{name}\" ({}). Name the \
                             one to change by its entryId.",
                            rows.len(),
                            ids.join(", ")
                        )))
                    }
                    Some(rows) => Ok(rows),
                },
            })
            .collect()
    }

    /// Apply `ops` as the viewer, with the table's version after the write.
    async fn apply(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: &Viewer,
        batch: OpBatch,
    ) -> Result<(Vec<OpResult>, Option<TableVersion>), WorkflowError> {
        let applied = self
            .pipelines
            .apply_ops(receipt, viewer.acting_bot, batch)
            .await?;
        let version = applied
            .results
            .iter()
            .filter_map(OpResult::table_version)
            .next_back();
        Ok((applied.results, version))
    }
}

impl<Pipelines, Crm, Access> PipelineWorkflowService
    for PipelineWorkflowServiceImpl<Pipelines, Crm, Access>
where
    Pipelines: PipelineService,
    Crm: CrmService,
    Access: EntityAccessService,
{
    #[tracing::instrument(skip_all, err)]
    async fn pipelines(&self, viewer: &Viewer) -> Result<Vec<PipelineOverview>, WorkflowError> {
        let team = self.team(viewer).await?.ok_or(WorkflowError::NoTeam)?;
        let mut overviews = Vec::new();
        for pipeline in self.pipelines.list(team).await? {
            let receipt = self
                .receipt::<ViewAccessLevel>(viewer, pipeline.pipeline.id)
                .await?;
            let table = self.pipelines.table(receipt).await?;
            overviews.push(PipelineOverview::new(pipeline, table));
        }
        Ok(overviews)
    }

    #[tracing::instrument(skip_all, fields(pipeline = %pipeline), err)]
    async fn find(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        query: EntryQuery,
    ) -> Result<FoundEntries, WorkflowError> {
        let receipt = self.receipt::<ViewAccessLevel>(viewer, pipeline).await?;
        let overview = self.overview(&receipt).await?;
        let filters = query
            .filters
            .iter()
            .map(|(name, wanted)| {
                let field = overview.field(name)?;
                // A wrong label or person fails here, even when no entry exists.
                fields::matches(field, None, wanted, &viewer.user_id)
                    .map_err(WorkflowError::Invalid)?;
                Ok((field, wanted))
            })
            .collect::<Result<Vec<_>, WorkflowError>>()?;
        let sort = query
            .sort
            .as_ref()
            .map(|(name, descending)| Ok::<_, WorkflowError>((overview.field(name)?, *descending)))
            .transpose()?;

        let (rows, complete) = self.scan(&receipt).await?;
        let record_field = overview.record_field();
        let wanted_records: HashSet<Uuid> = query.records.iter().copied().collect();
        let mut matched = Vec::new();
        for row in &rows {
            let tracked = record_id(row.cells.get(&record_field.id));
            if !wanted_records.is_empty() && !tracked.is_some_and(|id| wanted_records.contains(&id))
            {
                continue;
            }
            let mut keep = true;
            for (field, wanted) in &filters {
                if !fields::matches(field, row.cells.get(&field.id), wanted, &viewer.user_id)
                    .map_err(WorkflowError::Invalid)?
                {
                    keep = false;
                    break;
                }
            }
            if keep {
                matched.push(row);
            }
        }

        let team = self.team(viewer).await?;
        let records = self
            .records(viewer, team.as_ref(), &overview, &matched)
            .await?;
        let mut entries: Vec<PipelineEntryView> = matched
            .into_iter()
            .map(|row| entry_view(&overview, row, &records))
            .filter(|entry| {
                query
                    .search
                    .as_deref()
                    .is_none_or(|search| entry.record.matches(search))
            })
            .collect();
        let counts = option_counts(&overview, &entries);
        let totals = totals(&overview, &entries);
        if let Some((field, descending)) = sort {
            entries.sort_by(|left, right| {
                fields::compare(
                    field,
                    value_of(left, &field.name),
                    value_of(right, &field.name),
                    descending,
                )
            });
        }
        let matched = entries.len();
        entries.truncate(query.limit);
        Ok(FoundEntries {
            pipeline: overview,
            entries,
            matched,
            complete,
            counts,
            totals,
        })
    }

    #[tracing::instrument(skip_all, err)]
    async fn search_entries(
        &self,
        viewer: &Viewer,
        search: &str,
        limit: usize,
    ) -> Result<Vec<RecordEntries>, WorkflowError> {
        let mut found = Vec::new();
        for overview in self.pipelines(viewer).await? {
            let query = EntryQuery {
                search: Some(search.to_owned()),
                limit,
                ..Default::default()
            };
            let matches = self
                .find(viewer, overview.pipeline.pipeline.id, query)
                .await?;
            if !matches.entries.is_empty() {
                found.push(RecordEntries {
                    pipeline: matches.pipeline.pipeline,
                    entries: matches.entries,
                });
            }
        }
        Ok(found)
    }

    #[tracing::instrument(skip_all, err)]
    async fn record_entries(
        &self,
        viewer: &Viewer,
        records: &[Uuid],
    ) -> Result<Vec<RecordEntries>, WorkflowError> {
        let team = self.team(viewer).await?;
        let mut found: Vec<RecordEntries> = Vec::new();
        for record_type in [PipelineRecordType::Company, PipelineRecordType::Contact] {
            let entries = self
                .pipelines
                .entries(&viewer.user_id, record_type, records)
                .await?;
            let ids: Vec<Uuid> = entries.iter().map(|entry| entry.record_id).collect();
            let named = records::records(
                self.crm.as_ref(),
                team.as_ref(),
                viewer.user_id.as_ref(),
                record_type,
                &ids,
            )
            .await?;
            for entry in entries {
                let pipeline = entry.pipeline.pipeline.clone();
                let fields: Vec<PipelineField> = entry
                    .columns
                    .iter()
                    .map(|column| PipelineField::new(column, &pipeline))
                    .collect();
                let view = PipelineEntryView {
                    entry_id: entry.row_id,
                    record: named
                        .get(&entry.record_id)
                        .cloned()
                        .unwrap_or_else(|| PipelineRecord::unnamed(entry.record_id)),
                    fields: field_values(&fields, &entry.cells),
                };
                match found
                    .iter_mut()
                    .find(|group| group.pipeline.pipeline.id == pipeline.id)
                {
                    Some(group) => group.entries.push(view),
                    None => found.push(RecordEntries {
                        pipeline: entry.pipeline.as_ref().clone(),
                        entries: vec![view],
                    }),
                }
            }
        }
        Ok(found)
    }

    #[tracing::instrument(skip_all, fields(pipeline = %pipeline), err)]
    async fn add(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        additions: Vec<EntryAddition>,
        allow_duplicates: bool,
    ) -> Result<AddedEntries, WorkflowError> {
        if additions.is_empty() {
            return Err(WorkflowError::Invalid(
                "Name at least one company or contact to add.".into(),
            ));
        }
        let receipt = self.receipt::<EditAccessLevel>(viewer, pipeline).await?;
        let view = receipt.clone().try_into_requirement::<ViewAccessLevel>()?;
        let overview = self.overview(&view).await?;
        let record_type = overview.pipeline.pipeline.record_type;
        let team = self.team(viewer).await?;

        let mut resolved = Vec::with_capacity(additions.len());
        for addition in additions {
            let id = match &addition.record {
                RecordTarget::Id(id) => *id,
                RecordTarget::Email(email) => {
                    let team = team.as_ref().ok_or(WorkflowError::NoTeam)?;
                    let contact = self
                        .crm
                        .get_contact_by_email(team, email)
                        .await?
                        .ok_or_else(|| {
                            WorkflowError::Invalid(format!(
                                "No contact in the team's CRM has the email {email}."
                            ))
                        })?;
                    match record_type {
                        PipelineRecordType::Company => contact.company_id,
                        PipelineRecordType::Contact => contact.id,
                    }
                }
            };
            self.access
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    &viewer.user_id,
                    None,
                    &id.to_string(),
                    match record_type {
                        PipelineRecordType::Company => EntityType::CrmCompany,
                        PipelineRecordType::Contact => EntityType::CrmContact,
                    },
                )
                .await
                .map_err(|error| match error {
                    AccessError::NotFound(_)
                    | AccessError::Unauthorized
                    | AccessError::UnauthorizedWithMessage(_)
                    | AccessError::BadRequest(_) => WorkflowError::Invalid(match record_type {
                        PipelineRecordType::Company => format!(
                            "{id} is not a CRM company the user can see. Find company ids with \
                             ListCompanies, or add a company by one of its contacts' email."
                        ),
                        PipelineRecordType::Contact => format!(
                            "{id} is not a CRM contact the user can see. Add a contact by its \
                             email address."
                        ),
                    }),
                    other => other.into(),
                })?;
            let cells = cells(&overview, &addition.set, viewer)?;
            resolved.push((id, cells));
        }

        let ids: Vec<Uuid> = resolved.iter().map(|(id, _)| *id).collect();
        let mut present: HashMap<Uuid, RowId> = HashMap::new();
        for reference in self.pipelines.record_rows(view.clone(), &ids).await? {
            present
                .entry(reference.record_id)
                .or_insert(reference.row_id);
        }
        let mut seen = HashSet::new();
        let mut already = Vec::new();
        let mut inserts = Vec::new();
        for (id, mut cells) in resolved {
            if !allow_duplicates {
                if !seen.insert(id) {
                    continue;
                }
                if let Some(row) = present.get(&id) {
                    already.push(*row);
                    continue;
                }
            }
            cells.insert(
                0,
                CellWrite {
                    column: overview.record_field().id,
                    value: CellValue::Entities(vec![EntityRef {
                        entity_type: overview.record_kind(),
                        entity_id: id.to_string(),
                    }]),
                },
            );
            inserts.push(cells);
        }

        let (added, version) = if inserts.is_empty() {
            (Vec::new(), None)
        } else {
            let op = DatabaseOp::Rows {
                table: overview.pipeline.pipeline.table_id,
                change: RowsChange::Insert { rows: inserts },
            };
            let (results, version) = self.apply(receipt, viewer, OpBatch::from(vec![op])).await?;
            let added = results
                .into_iter()
                .flat_map(|result| match result {
                    OpResult::Rows {
                        change: RowsResult::Inserted { rows },
                        ..
                    } => rows,
                    _ => Vec::new(),
                })
                .collect();
            (added, version)
        };
        let rows = self
            .pipelines
            .read_rows(view, &[added.as_slice(), already.as_slice()].concat())
            .await?;
        let references: Vec<&StorageRow> = rows.iter().collect();
        let records = self
            .records(viewer, team.as_ref(), &overview, &references)
            .await?;
        let views = |ids: &[RowId]| -> Vec<PipelineEntryView> {
            ids.iter()
                .filter_map(|id| rows.iter().find(|row| row.row_id == *id))
                .map(|row| entry_view(&overview, row, &records))
                .collect()
        };
        Ok(AddedEntries {
            added: views(&added),
            already_present: views(&already),
            version,
        })
    }

    #[tracing::instrument(skip_all, fields(pipeline = %pipeline), err)]
    async fn update(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        updates: Vec<EntryUpdate>,
        base_version: Option<TableVersion>,
    ) -> Result<UpdatedEntries, WorkflowError> {
        if updates.is_empty() {
            return Err(WorkflowError::Invalid(
                "Name at least one entry to update.".into(),
            ));
        }
        let receipt = self.receipt::<EditAccessLevel>(viewer, pipeline).await?;
        let view = receipt.clone().try_into_requirement::<ViewAccessLevel>()?;
        let overview = self.overview(&view).await?;
        let targets: Vec<EntryTarget> = updates.iter().map(|update| update.target).collect();
        let rows: Vec<RowId> = self
            .target_rows(&view, &overview, &targets, true)
            .await?
            .into_iter()
            .flatten()
            .collect();
        let mut changes = Vec::with_capacity(updates.len());
        let mut seen = HashSet::new();
        for (row, update) in rows.iter().zip(&updates) {
            if update.set.is_empty() {
                return Err(WorkflowError::Invalid(format!(
                    "Name at least one field to set on entry {row}."
                )));
            }
            if !seen.insert(*row) {
                return Err(WorkflowError::Invalid(format!(
                    "Entry {row} is named twice; give all of its changes in one update."
                )));
            }
            changes.push(RowChange {
                row: *row,
                cells: cells(&overview, &update.set, viewer)?,
            });
        }

        let before = self.pipelines.read_rows(view.clone(), &rows).await?;
        let table = overview.pipeline.pipeline.table_id;
        let batch = OpBatch {
            ops: vec![DatabaseOp::Rows {
                table,
                change: RowsChange::Update {
                    changes: RowChanges::PerRow { rows: changes },
                },
            }],
            base_versions: base_version
                .map(|version| HashMap::from([(table, version)]))
                .unwrap_or_default(),
        };
        let (_, version) = self.apply(receipt, viewer, batch).await?;
        let after = self.pipelines.read_rows(view, &rows).await?;
        let team = self.team(viewer).await?;
        let references: Vec<&StorageRow> = after.iter().collect();
        let records = self
            .records(viewer, team.as_ref(), &overview, &references)
            .await?;
        let updated = rows
            .iter()
            .zip(&updates)
            .map(|(row, update)| {
                let cells_of = |rows: &[StorageRow]| {
                    rows.iter()
                        .find(|candidate| candidate.row_id == *row)
                        .map(|found| found.cells.clone())
                        .unwrap_or_default()
                };
                let (old, new) = (cells_of(&before), cells_of(&after));
                let record = record_id(new.get(&overview.record_field().id))
                    .map(|id| {
                        records
                            .get(&id)
                            .cloned()
                            .unwrap_or_else(|| PipelineRecord::unnamed(id))
                    })
                    .unwrap_or_else(|| PipelineRecord::unnamed(Uuid::nil()));
                let changes = update
                    .set
                    .iter()
                    .filter_map(|(name, _)| overview.field(name).ok())
                    .map(|field| FieldChange {
                        field: field.name.clone(),
                        before: old
                            .get(&field.id)
                            .and_then(|v| fields::field_value(field, v)),
                        after: new
                            .get(&field.id)
                            .and_then(|v| fields::field_value(field, v)),
                    })
                    .collect();
                UpdatedEntry {
                    entry_id: *row,
                    record,
                    changes,
                }
            })
            .collect();
        Ok(UpdatedEntries { updated, version })
    }

    #[tracing::instrument(skip_all, fields(pipeline = %pipeline), err)]
    async fn remove(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        targets: Vec<EntryTarget>,
    ) -> Result<RemovedEntries, WorkflowError> {
        if targets.is_empty() {
            return Err(WorkflowError::Invalid(
                "Name at least one entry to remove.".into(),
            ));
        }
        let receipt = self.receipt::<EditAccessLevel>(viewer, pipeline).await?;
        let view = receipt.clone().try_into_requirement::<ViewAccessLevel>()?;
        let overview = self.overview(&view).await?;
        let mut rows: Vec<RowId> = self
            .target_rows(&view, &overview, &targets, false)
            .await?
            .into_iter()
            .flatten()
            .collect();
        let mut seen = HashSet::new();
        rows.retain(|row| seen.insert(*row));
        let before = self.pipelines.read_rows(view, &rows).await?;
        let team = self.team(viewer).await?;
        let references: Vec<&StorageRow> = before.iter().collect();
        let records = self
            .records(viewer, team.as_ref(), &overview, &references)
            .await?;
        let op = DatabaseOp::Rows {
            table: overview.pipeline.pipeline.table_id,
            change: RowsChange::Delete { rows },
        };
        let (_, version) = self.apply(receipt, viewer, OpBatch::from(vec![op])).await?;
        Ok(RemovedEntries {
            removed: before
                .iter()
                .map(|row| entry_view(&overview, row, &records))
                .collect(),
            version,
        })
    }

    #[tracing::instrument(skip_all, err)]
    async fn create(
        &self,
        viewer: &Viewer,
        input: NewPipeline,
    ) -> Result<PipelineOverview, WorkflowError> {
        let team = self.team(viewer).await?.ok_or(WorkflowError::NoTeam)?;
        let created = self
            .pipelines
            .create(
                team,
                CreatePipeline {
                    name: input.name,
                    record_type: input.record_type,
                    sharing: input.sharing,
                },
            )
            .await?;
        let id = created.pipeline.id;
        let view = self.receipt::<ViewAccessLevel>(viewer, id).await?;
        let overview = self.overview(&view).await?;
        if input.stages.is_empty() && input.fields.is_empty() {
            return Ok(overview);
        }
        let mut ops = Vec::new();
        if !input.stages.is_empty() {
            let stage = overview.field(STAGE_FIELD)?;
            ops.extend(stage.options.iter().map(|(option, _)| DatabaseOp::Column {
                table: overview.pipeline.pipeline.table_id,
                column: stage.id,
                change: ColumnChange::DeleteOption { option: *option },
            }));
            ops.push(add_options(&overview, stage, &input.stages));
        }
        for field in &input.fields {
            ops.push(add_field(&overview, field)?);
        }
        let receipt = self.receipt::<EditAccessLevel>(viewer, id).await?;
        self.apply(receipt, viewer, OpBatch::from(ops))
            .await
            .map_err(|error| {
                WorkflowError::Invalid(format!(
                    "Created pipeline \"{}\" ({id}) with the default stages and fields, but \
                     could not set its stages and fields: {error}. Change them with EditPipeline.",
                    overview.pipeline.pipeline.name
                ))
            })?;
        self.overview(&view).await
    }

    #[tracing::instrument(skip_all, fields(pipeline = %pipeline), err)]
    async fn edit(
        &self,
        viewer: &Viewer,
        pipeline: Uuid,
        edit: PipelineEdit,
    ) -> Result<PipelineOverview, WorkflowError> {
        let receipt = self.receipt::<EditAccessLevel>(viewer, pipeline).await?;
        let view = receipt.clone().try_into_requirement::<ViewAccessLevel>()?;
        let overview = self.overview(&view).await?;
        let table = overview.pipeline.pipeline.table_id;
        let mut ops = Vec::new();
        for (from, to) in &edit.rename_fields {
            let field = overview.field(from)?;
            ops.push(DatabaseOp::Column {
                table,
                column: field.id,
                change: ColumnChange::Rename {
                    name: to.trim().to_owned(),
                    previous_name: Some(field.name.clone()),
                },
            });
        }
        for name in &edit.remove_fields {
            let field = overview.field(name)?;
            if field.is_record() {
                return Err(WorkflowError::Invalid(format!(
                    "\"{}\" is the record each entry tracks and cannot be removed.",
                    field.name
                )));
            }
            ops.push(DatabaseOp::Column {
                table,
                column: field.id,
                change: ColumnChange::Delete,
            });
        }
        for field in &edit.add_fields {
            ops.push(add_field(&overview, field)?);
        }
        for (name, labels) in &edit.add_options {
            let field = select_field(&overview, name)?;
            ops.push(add_options(&overview, field, labels));
        }
        for (name, from, to) in &edit.rename_options {
            let field = select_field(&overview, name)?;
            ops.push(DatabaseOp::Column {
                table,
                column: field.id,
                change: ColumnChange::UpdateOption {
                    option: field.option(from).map_err(WorkflowError::Invalid)?,
                    label: Some(to.trim().to_owned()),
                    color: None,
                },
            });
        }
        for (name, label) in &edit.remove_options {
            let field = select_field(&overview, name)?;
            ops.push(DatabaseOp::Column {
                table,
                column: field.id,
                change: ColumnChange::DeleteOption {
                    option: field.option(label).map_err(WorkflowError::Invalid)?,
                },
            });
        }
        if ops.is_empty() && edit.name.is_none() && edit.sharing.is_none() {
            return Err(WorkflowError::Invalid(
                "Nothing to change: give a new name, sharing, or field changes.".into(),
            ));
        }
        // Refuse a sharing change before writing anything else, so a refusal
        // never leaves the rest of the edit half-applied.
        let share = match edit.sharing {
            Some(sharing) => Some((
                self.receipt::<OwnerAccessLevel>(viewer, pipeline)
                    .await
                    .map_err(|_| {
                        WorkflowError::Invalid(
                            "Only the pipeline's owner can change who it is shared with; \
                             nothing was changed."
                                .into(),
                        )
                    })?,
                sharing,
            )),
            None => None,
        };
        if !ops.is_empty() {
            self.apply(receipt.clone(), viewer, OpBatch::from(ops))
                .await?;
        }
        if let Some(name) = edit.name {
            self.pipelines.rename(receipt, name).await?;
        }
        if let Some((owner, sharing)) = share {
            self.pipelines.share(owner, sharing).await?;
        }
        self.overview(&view).await
    }
}

impl<Pipelines, Crm, Access> PipelineWorkflowServiceImpl<Pipelines, Crm, Access>
where
    Pipelines: PipelineService,
{
    /// Every row of the pipeline up to [`MAX_SCANNED_ROWS`], and whether
    /// that was all of them.
    async fn scan(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<(Vec<StorageRow>, bool), WorkflowError> {
        let mut rows = Vec::new();
        let mut after = None;
        loop {
            let page = self
                .pipelines
                .query_rows(
                    receipt.clone(),
                    StorageRowsQuery {
                        after,
                        ..Default::default()
                    },
                )
                .await?;
            rows.extend(page.rows);
            match page.next {
                None => return Ok((rows, true)),
                Some(_) if rows.len() >= MAX_SCANNED_ROWS => {
                    rows.truncate(MAX_SCANNED_ROWS);
                    return Ok((rows, false));
                }
                Some(next) => after = Some(next),
            }
        }
    }
}
