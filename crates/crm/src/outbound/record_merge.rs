//! Merges in Postgres: one transaction across every owner whose rows name the
//! merged records. Each owner moves its own rows through its own functions;
//! every changed row goes to the merge log with its value before, so the
//! merge could be undone later.
//!
//! Lock order, shared with every CRM writer: the team's exclusive privacy
//! lock, the mailbox guard, domain locks in order, the team, the records and
//! their people in id order, the pipelines holding their entries, then the
//! property, message, favorite and list rows their owners lock.

#[cfg(test)]
mod test;

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use activity::{
    Action, Activity, Actor, DomainActivity, DroppedPropertyValue, MergedRecordName, RecordMerge,
};
use databases::domain::models::{DatabaseId, OpBatch, Viewer};
use databases::domain::storage::DatabaseStorageTransactions;
use model_entity::EntityType as FavoriteEntityType;
use models_databases::{
    CellValue, CellWrite, ColumnId, DatabaseOp, EntityKind, EntityRef, RowChange, RowChanges,
    RowId, RowsChange, TableId,
};
use models_properties::{EntityType as PropertyEntityType, service::property_value::PropertyValue};
use properties::outbound::record_merge::{self as property_merge, MergeEntityValue, ValueScope};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool, Postgres, Transaction};
use uuid::Uuid;

use super::companies_repo::{CompaniesRepositoryImpl, MemberRules, merge::CompanyMergeState};
use crate::domain::{
    auth::CrmMemberAccess,
    email_rules::EmailRuleSet,
    model::CrmError,
    record_merge::{
        MergeCommand, MergeEmailSync, MergeError, MergeMoves, MergeOutcome, MergePreview,
        MergeRecordType, MergeScope, MergeTargets, MergedRecord, PipelineMoves, ReferenceHolder,
        SharedPipeline, SharingRulesChoice, SharingRulesPreview,
        plan::{self, RecordValue, ValuePlan, ValueVisibility},
        service::{ChangedEntityProperty, MergeCommitted, RecordMergeRepository},
    },
};

fn db(error: sqlx::Error) -> MergeError {
    MergeError::Crm(CrmError::StorageLayerError(error.into()))
}

/// One row a merge changed, with what it held before (`crm_merge_changes`).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MergeChange {
    owner: &'static str,
    table: &'static str,
    key: Value,
    previous: Value,
}

impl MergeChange {
    pub(crate) fn new(
        owner: &'static str,
        table: &'static str,
        key: Value,
        previous: Value,
    ) -> Self {
        Self {
            owner,
            table,
            key,
            previous,
        }
    }
}

/// Merges records in Postgres, moving pipeline cells through `Databases`.
pub struct PgRecordMergeRepository<Databases> {
    pool: PgPool,
    databases: Arc<Databases>,
}

impl<Databases> PgRecordMergeRepository<Databases> {
    /// Construct at the composition root, with the databases service the
    /// CRM's pipelines write through.
    pub fn new(pool: PgPool, databases: Arc<Databases>) -> Self {
        Self { pool, databases }
    }
}

impl<Databases: Send + Sync + 'static> CrmMemberAccess for PgRecordMergeRepository<Databases> {
    async fn member_has_crm_access(&self, team_id: Uuid, user_id: &str) -> Result<bool, CrmError> {
        super::member_access::member_has_crm_access(&self.pool, team_id, user_id).await
    }
}

/// A pipeline cell naming one of the merged records.
#[derive(Debug, Clone)]
struct PipelineCell {
    pipeline_id: Uuid,
    pipeline_name: String,
    /// In the trash: moved with the rest, never shown in a review.
    trashed: bool,
    database_id: Uuid,
    table_id: Uuid,
    row_id: Uuid,
    column_id: Uuid,
    primary: bool,
    values: Value,
}

/// A database cell naming one of the merged records, in a pipeline or not.
#[derive(Debug, Clone)]
struct StoredCell {
    database_id: Uuid,
    table_id: Uuid,
    row_id: Uuid,
    column_id: Uuid,
    values: Value,
}

impl From<&PipelineCell> for StoredCell {
    fn from(cell: &PipelineCell) -> Self {
        Self {
            database_id: cell.database_id,
            table_id: cell.table_id,
            row_id: cell.row_id,
            column_id: cell.column_id,
            values: cell.values.clone(),
        }
    }
}

/// Everything a company merge's review is built from.
struct CompanyFacts {
    state: CompanyMergeState,
    values: Vec<MergeEntityValue>,
    references: Vec<ReferenceHolder>,
    cells: Vec<PipelineCell>,
    discussion_messages: i64,
    sharing: Vec<MemberRules>,
}

/// A review and what the commit would write for it.
struct CompanyReview {
    preview: MergePreview,
    values: ValuePlan,
}

impl<Databases> PgRecordMergeRepository<Databases>
where
    Databases: DatabaseStorageTransactions<Transaction = Transaction<'static, Postgres>>,
{
    async fn company_facts(
        conn: &mut PgConnection,
        team: Uuid,
        targets: &MergeTargets,
        state: CompanyMergeState,
        lock: bool,
    ) -> Result<CompanyFacts, MergeError> {
        let all: Vec<Uuid> = targets.all_sorted();
        let sources = targets.sources();
        let source_text: Vec<String> = sources.iter().map(Uuid::to_string).collect();
        let all_text: Vec<String> = all.iter().map(Uuid::to_string).collect();

        let cells = if lock {
            lock_pipelines_holding(conn, team, &all).await?
        } else {
            pipeline_cells(conn, team, &all).await?
        };
        let values = if lock {
            property_merge::lock_entity_values_in(
                conn,
                PropertyEntityType::Company,
                &all_text,
                &targets.survivor().to_string(),
            )
            .await
            .map_err(db)?
        } else {
            property_merge::read_entity_values_in(conn, PropertyEntityType::Company, &all_text)
                .await
                .map_err(db)?
        };
        let references =
            property_merge::referencing_rows_in(conn, PropertyEntityType::Company, &source_text)
                .await
                .map_err(db)?
                .into_iter()
                .map(|row| ReferenceHolder {
                    entity_type: row.entity_type,
                    entity_id: row.entity_id,
                    owner: row.owner,
                })
                .collect();
        let discussion_messages = messages::outbound::record_merge::count_discussion_messages_in(
            conn,
            messages::outbound::record_merge::MergedParent::CrmCompany,
            sources,
        )
        .await
        .map_err(db)?;
        let sharing =
            CompaniesRepositoryImpl::rules_naming_companies(conn, team, sources, lock).await?;
        Ok(CompanyFacts {
            state,
            values,
            references,
            cells,
            discussion_messages,
            sharing,
        })
    }
}

/// The review of a company merge, and the value plan behind it.
fn company_review(targets: &MergeTargets, facts: &CompanyFacts) -> CompanyReview {
    let state = &facts.state;
    let record_values: Vec<RecordValue> = facts
        .values
        .iter()
        .filter_map(|value| {
            let stored: PropertyValue = serde_json::from_value(value.values.clone()?).ok()?;
            Some(RecordValue {
                record_id: value.entity_id.parse().ok()?,
                property_id: value.property_definition_id,
                property_name: value.property_name.clone(),
                visibility: match value.scope {
                    ValueScope::Team => ValueVisibility::Team,
                    ValueScope::Personal => ValueVisibility::Private,
                },
                value: stored,
            })
        })
        .collect();
    let values = plan::plan_values(targets, &record_values);

    let mut identifiers: Vec<String> = Vec::new();
    for company in std::iter::once(&state.survivor).chain(&state.sources) {
        for domain in &company.domains {
            if !identifiers.contains(&domain.domain) {
                identifiers.push(domain.domain.clone());
            }
        }
    }

    // Entries are rows whose primary cell names one of the records; a row
    // counts once, as a source's when any of its cells names a source.
    let mut entries: BTreeMap<Uuid, (String, HashMap<Uuid, bool>)> = BTreeMap::new();
    for cell in facts
        .cells
        .iter()
        .filter(|cell| cell.primary && !cell.trashed)
    {
        let from_source = names_any(&cell.values, EntityKind::Company, targets.sources());
        let rows = &mut entries
            .entry(cell.pipeline_id)
            .or_insert_with(|| (cell.pipeline_name.clone(), HashMap::new()))
            .1;
        *rows.entry(cell.row_id).or_default() |= from_source;
    }
    let pipeline_moves: Vec<PipelineMoves> = entries
        .iter()
        .map(|(pipeline_id, (_, rows))| PipelineMoves {
            pipeline_id: *pipeline_id,
            entries: u32::try_from(rows.values().filter(|from_source| **from_source).count())
                .unwrap_or(u32::MAX),
        })
        .filter(|moves| moves.entries > 0)
        .collect();
    let pipeline_entries = pipeline_moves
        .iter()
        .map(|moves| moves.entries)
        .fold(0u32, u32::saturating_add);
    let shared_pipelines = entries
        .iter()
        .filter(|(_, (_, rows))| rows.len() > 1 && rows.values().any(|source| *source))
        .map(|(pipeline_id, (name, rows))| SharedPipeline {
            pipeline_id: *pipeline_id,
            name: name.clone(),
            entries_after: u32::try_from(rows.len()).unwrap_or(u32::MAX),
        })
        .collect();

    let source_domains = state.source_domains();
    let sharing_rules = (!facts.sharing.is_empty()).then(|| SharingRulesPreview {
        teammates: u32::try_from(facts.sharing.len()).unwrap_or(u32::MAX),
        keep_fits: facts.sharing.iter().all(|member| {
            plan::rewrite_sharing_rules(
                &member.rules,
                MergeRecordType::Company,
                &source_domains,
                SharingRulesChoice::Keep,
            )
            .is_ok()
        }),
    });

    let mut preview = MergePreview {
        revision: String::new(),
        record_type: MergeRecordType::Company,
        survivor: MergedRecord {
            id: state.survivor.id,
            name: state.survivor.name.clone(),
        },
        sources: state
            .sources
            .iter()
            .map(|company| MergedRecord {
                id: company.id,
                name: company.name.clone(),
            })
            .collect(),
        identifiers,
        moves: MergeMoves {
            contacts: u32::try_from(state.moving_people()).unwrap_or(u32::MAX),
            pipeline_entries,
            references: u32::try_from(facts.references.len()).unwrap_or(u32::MAX),
            discussion_messages: u32::try_from(facts.discussion_messages).unwrap_or(u32::MAX),
        },
        shared_pipelines,
        conflicts: values.conflicts.clone(),
        email_sync: MergeEmailSync {
            survivor_syncs: state.survivor.email_sync,
            kept_out: state.kept_out(),
        },
        sharing_rules,
        blocked: plan::same_address_block(&state.people),
        pipeline_moves,
        reference_holders: facts.references.clone(),
    };
    // Whose rules change and at which revision, and which company holds each
    // domain, are not shown, but a change to any makes the commit write
    // something else.
    let unshown: Vec<String> = facts
        .sharing
        .iter()
        .map(|member| format!("{}:{}", member.user_id, member.revision))
        .chain(
            std::iter::once(&state.survivor)
                .chain(&state.sources)
                .map(|company| {
                    let mut domains: Vec<&str> =
                        company.domains.iter().map(|d| d.domain.as_str()).collect();
                    domains.sort_unstable();
                    format!("{}:{}", company.id, domains.join(","))
                }),
        )
        .collect();
    preview.revision = plan::revision(&preview, &unshown);
    CompanyReview { preview, values }
}

/// Whether a stored reference value names one of `ids` of `kind`.
fn names_any(values: &Value, kind: EntityKind, ids: &[Uuid]) -> bool {
    let tag: &str = kind.into();
    values
        .get("value")
        .and_then(Value::as_array)
        .is_some_and(|references| {
            references.iter().any(|reference| {
                reference.get("entity_type").and_then(Value::as_str) == Some(tag)
                    && reference
                        .get("entity_id")
                        .and_then(Value::as_str)
                        .and_then(|id| id.parse::<Uuid>().ok())
                        .is_some_and(|id| ids.contains(&id))
            })
        })
}

/// The cell's references with merged records replaced by the one that
/// stays, listed once each, in their first place.
fn retargeted(
    values: &Value,
    kind: EntityKind,
    sources: &[Uuid],
    survivor: Uuid,
) -> Vec<EntityRef> {
    let tag: &str = kind.into();
    let mut refs: Vec<EntityRef> = Vec::new();
    for reference in values
        .get("value")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        // Stored references are snake_case; the op's are camelCase.
        let (Some(entity_type), Some(entity_id)) = (
            reference
                .get("entity_type")
                .and_then(|kind| serde_json::from_value::<EntityKind>(kind.clone()).ok()),
            reference.get("entity_id").and_then(Value::as_str),
        ) else {
            continue;
        };
        let mut parsed = EntityRef {
            entity_type,
            entity_id: entity_id.to_owned(),
        };
        let merged = reference.get("entity_type").and_then(Value::as_str) == Some(tag)
            && parsed
                .entity_id
                .parse::<Uuid>()
                .is_ok_and(|id| sources.contains(&id));
        if merged {
            parsed.entity_id = survivor.to_string();
        }
        if !refs.iter().any(|existing| {
            existing.entity_type == parsed.entity_type && existing.entity_id == parsed.entity_id
        }) {
            refs.push(parsed);
        }
    }
    refs
}

/// The cells of the team's pipelines, trashed ones included, that reference
/// one of `records`, in any column. Starts from the records' references
/// through `idx_ep_database_row_references_gin`, as `referencing_rows` does.
async fn pipeline_cells(
    conn: &mut PgConnection,
    team: Uuid,
    records: &[Uuid],
) -> Result<Vec<PipelineCell>, MergeError> {
    let rows = sqlx::query!(
        r#"WITH reference AS MATERIALIZED (
               SELECT DISTINCT r.id AS row_id, r.table_id, ep.property_definition_id, ep.values
               FROM UNNEST($2::uuid[]) AS record(id)
               JOIN entity_properties ep
                 ON ep.entity_type = 'DATABASE_ROW'
                AND ep.values ->> 'type' = 'EntityReference'
                AND ep.values -> 'value' @> jsonb_build_array(jsonb_build_object('entity_id', record.id::text))
               JOIN database_rows r
                 ON r.id = (CASE
                     WHEN ep.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     THEN ep.entity_id
                 END)::uuid
           )
           SELECT p.id AS "pipeline_id!", p.name AS "pipeline_name!",
                  p.trashed_at IS NOT NULL AS "trashed!", p.database_id AS "database_id!",
                  reference.table_id AS "table_id!", reference.row_id AS "row_id!", c.id AS "column_id!",
                  c.id = p.primary_column_id AS "primary!", reference.values AS "values!"
           FROM reference
           JOIN crm_pipeline_entities p ON p.table_id = reference.table_id
           JOIN database_columns c
             ON c.table_id = reference.table_id
            AND c.property_definition_id = reference.property_definition_id
           WHERE p.team_id = $1
           ORDER BY p.id, reference.row_id, c.id"#,
        team,
        records,
    )
    .fetch_all(conn)
    .await
    .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(|row| PipelineCell {
            pipeline_id: row.pipeline_id,
            pipeline_name: row.pipeline_name,
            trashed: row.trashed,
            database_id: row.database_id,
            table_id: row.table_id,
            row_id: row.row_id,
            column_id: row.column_id,
            primary: row.primary,
            values: row.values,
        })
        .collect())
}

/// The cells outside any pipeline that reference one of `records`: company
/// columns of ordinary Macro databases. Their writers serialize on the
/// table row the database write path locks, so no lock is taken here.
async fn database_cells(
    conn: &mut PgConnection,
    records: &[Uuid],
) -> Result<Vec<StoredCell>, MergeError> {
    let rows = sqlx::query!(
        r#"WITH reference AS MATERIALIZED (
               SELECT DISTINCT r.id AS row_id, r.table_id, ep.property_definition_id, ep.values
               FROM UNNEST($1::uuid[]) AS record(id)
               JOIN entity_properties ep
                 ON ep.entity_type = 'DATABASE_ROW'
                AND ep.values ->> 'type' = 'EntityReference'
                AND ep.values -> 'value' @> jsonb_build_array(jsonb_build_object('entity_id', record.id::text))
               JOIN database_rows r
                 ON r.id = (CASE
                     WHEN ep.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     THEN ep.entity_id
                 END)::uuid
           )
           SELECT t.database_id AS "database_id!", reference.table_id AS "table_id!",
                  reference.row_id AS "row_id!", c.id AS "column_id!", reference.values AS "values!"
           FROM reference
           JOIN database_tables t ON t.id = reference.table_id
           JOIN database_columns c
             ON c.table_id = reference.table_id
            AND c.property_definition_id = reference.property_definition_id
           WHERE NOT EXISTS (SELECT 1 FROM crm_pipeline_entities p WHERE p.table_id = reference.table_id)
           ORDER BY t.database_id, reference.row_id, c.id"#,
        records,
    )
    .fetch_all(conn)
    .await
    .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(|row| StoredCell {
            database_id: row.database_id,
            table_id: row.table_id,
            row_id: row.row_id,
            column_id: row.column_id,
            values: row.values,
        })
        .collect())
}

/// Hold the pipelines that reference `records` as their lifecycle readers
/// do. Their cell writers wait for the merge; a pipeline that gained such a
/// cell between the reads is locked on the next round.
async fn lock_pipelines_holding(
    conn: &mut PgConnection,
    team: Uuid,
    records: &[Uuid],
) -> Result<Vec<PipelineCell>, MergeError> {
    let mut locked: Vec<Uuid> = Vec::new();
    for _ in 0..3 {
        let cells = pipeline_cells(conn, team, records).await?;
        let mut wanted: Vec<Uuid> = cells.iter().map(|cell| cell.pipeline_id).collect();
        wanted.sort_unstable();
        wanted.dedup();
        let missing: Vec<Uuid> = wanted
            .iter()
            .copied()
            .filter(|id| !locked.contains(id))
            .collect();
        if missing.is_empty() {
            return Ok(cells);
        }
        sqlx::query_scalar!(
            "SELECT id FROM crm_pipeline_entities WHERE id = ANY($1) ORDER BY id FOR SHARE",
            &missing,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        locked.extend(missing);
        locked.sort_unstable();
    }
    Err(CrmError::Contended.into())
}

/// Write the merge's log rows in one statement.
async fn record_changes(
    conn: &mut PgConnection,
    merge_id: Uuid,
    changes: &[MergeChange],
) -> Result<(), MergeError> {
    let seq: Vec<i32> = (0..changes.len())
        .map(|index| i32::try_from(index).unwrap_or(i32::MAX))
        .collect();
    let owners: Vec<&str> = changes.iter().map(|change| change.owner).collect();
    let tables: Vec<&str> = changes.iter().map(|change| change.table).collect();
    let keys: Vec<Value> = changes.iter().map(|change| change.key.clone()).collect();
    let previous: Vec<Value> = changes
        .iter()
        .map(|change| change.previous.clone())
        .collect();
    sqlx::query!(
        r#"INSERT INTO crm_merge_changes (merge_id, seq, owner, table_name, row_key, previous)
           SELECT $1, seq, owner, table_name, row_key, previous
           FROM UNNEST($2::int[], $3::text[], $4::text[], $5::jsonb[], $6::jsonb[])
                AS change(seq, owner, table_name, row_key, previous)"#,
        merge_id,
        &seq,
        &owners as &[&str],
        &tables as &[&str],
        &keys,
        &previous,
    )
    .execute(conn)
    .await
    .map_err(db)?;
    Ok(())
}

/// A committed merge with this request key, if any: an exact retry gets its
/// result back; another merge under the same key is refused.
async fn replayed(
    conn: &mut PgConnection,
    scope: &MergeScope,
    request_key: Uuid,
    fingerprint: &str,
) -> Result<Option<MergeOutcome>, MergeError> {
    let saved = sqlx::query!(
        "SELECT request_fingerprint, result FROM crm_merges WHERE team_id = $1 AND user_id = $2 AND request_key = $3",
        scope.team_id,
        scope.actor.as_ref(),
        request_key,
    )
    .fetch_optional(conn)
    .await
    .map_err(db)?;
    match saved {
        None => Ok(None),
        Some(saved) if saved.request_fingerprint == fingerprint => Ok(Some(
            serde_json::from_value(saved.result)
                .map_err(|error| CrmError::StorageLayerError(error.into()))?,
        )),
        Some(_) => Err(MergeError::RequestReused),
    }
}

/// The merge's entry on the record that stays.
struct CompanyMerged {
    company_id: String,
    merge: RecordMerge,
}

impl DomainActivity for CompanyMerged {
    const ENTITY_TYPE: activity::EntityType = activity::EntityType::CrmCompany;

    fn entity_id(&self) -> &str {
        &self.company_id
    }

    fn into_action(self) -> Action {
        Action::RecordMerged(self.merge)
    }
}

impl<Databases> PgRecordMergeRepository<Databases>
where
    Databases: DatabaseStorageTransactions<Transaction = Transaction<'static, Postgres>>,
{
    /// Rewrite the pipeline cells naming a merged company, one batch per
    /// database, through the databases write path in the merge's transaction.
    async fn retarget_database_cells(
        &self,
        tx: &mut Transaction<'static, Postgres>,
        scope: &MergeScope,
        targets: &MergeTargets,
        cells: &[StoredCell],
    ) -> Result<Vec<MergeChange>, MergeError> {
        let mut by_database: BTreeMap<Uuid, BTreeMap<Uuid, BTreeMap<Uuid, Vec<CellWrite>>>> =
            BTreeMap::new();
        let mut changes = Vec::new();
        for cell in cells {
            if !names_any(&cell.values, EntityKind::Company, targets.sources()) {
                continue;
            }
            let refs = retargeted(
                &cell.values,
                EntityKind::Company,
                targets.sources(),
                targets.survivor(),
            );
            by_database
                .entry(cell.database_id)
                .or_default()
                .entry(cell.table_id)
                .or_default()
                .entry(cell.row_id)
                .or_default()
                .push(CellWrite {
                    column: ColumnId::from_uuid(cell.column_id),
                    value: CellValue::Entities(refs),
                });
            changes.push(MergeChange::new(
                "databases",
                "entity_properties",
                json!({ "row_id": cell.row_id, "column_id": cell.column_id }),
                cell.values.clone(),
            ));
        }
        for (database, tables) in by_database {
            let ops = tables
                .into_iter()
                .map(|(table, rows)| DatabaseOp::Rows {
                    table: TableId::from_uuid(table),
                    change: RowsChange::Update {
                        changes: RowChanges::PerRow {
                            rows: rows
                                .into_iter()
                                .map(|(row, cells)| RowChange {
                                    row: RowId::from_uuid(row),
                                    cells,
                                })
                                .collect(),
                        },
                    },
                })
                .collect::<Vec<_>>();
            self.databases
                .apply_storage_ops_in(
                    tx,
                    DatabaseId::from_uuid(database),
                    Viewer {
                        user_id: scope.actor.clone(),
                        acting_bot: None,
                    },
                    OpBatch::from(ops),
                )
                .await
                .map_err(|error| CrmError::StorageLayerError(anyhow::anyhow!(error)))?;
        }
        Ok(changes)
    }

    async fn commit_company(
        &self,
        tx: &mut Transaction<'static, Postgres>,
        scope: &MergeScope,
        command: &MergeCommand,
        merge_id: Uuid,
    ) -> Result<(MergeOutcome, Vec<ChangedEntityProperty>), MergeError> {
        let team = scope.team_id;
        let targets = &command.targets;
        let state = CompaniesRepositoryImpl::lock_company_merge(&mut *tx, team, targets).await?;
        let facts = Self::company_facts(&mut *tx, team, targets, state, true).await?;
        let review = company_review(targets, &facts);
        if review.preview.revision != command.revision {
            return Err(MergeError::PreviewStale);
        }
        if let Some(block) = review.preview.blocked.clone() {
            return Err(MergeError::Conflict(block));
        }
        let source_domains = facts.state.source_domains();
        let mut rewrites: Vec<(MemberRules, EmailRuleSet)> = Vec::new();
        for member in &facts.sharing {
            if let Some(rules) = plan::rewrite_sharing_rules(
                &member.rules,
                MergeRecordType::Company,
                &source_domains,
                command.sharing_rules,
            )? {
                rewrites.push((member.clone(), rules));
            }
        }

        let survivor = targets.survivor();
        let sources: Vec<String> = targets.sources().iter().map(Uuid::to_string).collect();
        let mut changes =
            CompaniesRepositoryImpl::fold_companies(&mut *tx, team, merge_id, &facts.state).await?;
        let details = json!({
            "merge_id": merge_id,
            "survivor_id": survivor,
            "merged_ids": targets.sources(),
            "choice": command.sharing_rules,
        });
        changes.extend(
            CompaniesRepositoryImpl::rewrite_merged_rules(
                &mut *tx, team, merge_id, &rewrites, &details,
            )
            .await?,
        );

        let moves: Vec<Uuid> = review
            .values
            .moved
            .iter()
            .filter_map(|(record, property)| {
                facts
                    .values
                    .iter()
                    .find(|value| {
                        value.entity_id == record.to_string()
                            && value.property_definition_id == *property
                    })
                    .map(|value| value.id)
            })
            .collect();
        let values = property_merge::merge_entity_values_in(
            &mut *tx,
            PropertyEntityType::Company,
            &survivor.to_string(),
            &sources,
            &facts.values,
            &moves,
        )
        .await
        .map_err(db)?;
        if values.unreviewed {
            return Err(MergeError::PreviewStale);
        }
        for value in values.moved.iter().chain(&values.deleted) {
            changes.push(MergeChange::new(
                "properties",
                "entity_properties",
                json!({ "id": value.id }),
                json!({
                    "entity_id": value.entity_id,
                    "property_definition_id": value.property_definition_id,
                    "values": value.values,
                    "created_at": value.created_at,
                    "updated_at": value.updated_at,
                }),
            ));
        }
        let references = property_merge::retarget_references_in(
            &mut *tx,
            PropertyEntityType::Company,
            &sources,
            &survivor.to_string(),
        )
        .await
        .map_err(db)?;
        changes.extend(references.iter().map(|reference| {
            MergeChange::new(
                "properties",
                "entity_properties",
                json!({ "id": reference.id }),
                json!({ "values": reference.previous }),
            )
        }));
        let stored = |value: &Value| serde_json::from_value::<PropertyValue>(value.clone()).ok();
        let mut written: Vec<ChangedEntityProperty> = values
            .written
            .iter()
            .map(|row| ChangedEntityProperty {
                entity_property_id: row.id,
                entity_id: row.entity_id.clone(),
                entity_type: row.entity_type,
                property_definition_id: row.property_definition_id,
                value: values
                    .moved
                    .iter()
                    .find(|moved| moved.id == row.id)
                    .and_then(|moved| moved.values.as_ref())
                    .and_then(stored),
                previous_value: None,
                updated_at: row.updated_at,
            })
            .collect();
        written.extend(references.iter().map(|row| ChangedEntityProperty {
            entity_property_id: row.id,
            entity_id: row.entity_id.clone(),
            entity_type: row.entity_type,
            property_definition_id: row.property_definition_id,
            value: stored(&row.values),
            previous_value: stored(&row.previous),
            updated_at: row.updated_at,
        }));

        // Pipelines, trashed ones too so a restore names the survivor, and
        // company columns of ordinary databases, through one write path.
        let mut cells: Vec<StoredCell> = facts.cells.iter().map(StoredCell::from).collect();
        cells.extend(database_cells(&mut *tx, &targets.all_sorted()).await?);
        changes.extend(
            self.retarget_database_cells(tx, scope, targets, &cells)
                .await?,
        );

        let discussions = messages::outbound::record_merge::merge_discussions_in(
            &mut *tx,
            messages::outbound::record_merge::MergedParent::CrmCompany,
            targets.sources(),
            survivor,
        )
        .await
        .map_err(db)?;
        changes.extend(discussions.messages.into_iter().map(|(id, previous)| {
            MergeChange::new(
                "messages",
                "comms_messages",
                json!({ "id": id }),
                json!({ "parent_entity_id": previous }),
            )
        }));
        changes.extend(discussions.threads.into_iter().map(|(id, previous)| {
            MergeChange::new(
                "messages",
                "comms_message_threads",
                json!({ "root_id": id }),
                json!({ "parent_entity_id": previous }),
            )
        }));
        changes.extend(discussions.mentions.into_iter().map(|(id, previous)| {
            MergeChange::new(
                "messages",
                "comms_entity_mentions",
                json!({ "id": id }),
                json!({ "entity_id": previous }),
            )
        }));

        let favorites = favorites::outbound::merge::retarget_favorites_in(
            &mut *tx,
            FavoriteEntityType::CrmCompany,
            &sources,
            &survivor.to_string(),
        )
        .await
        .map_err(db)?;
        changes.extend(favorites.moved.into_iter().map(|favorite| {
            MergeChange::new(
                "favorites",
                "favorite",
                json!({ "user_id": favorite.user_id, "entity_type": "crm_company", "entity_id": favorite.entity_id }),
                json!({ "sort_order": favorite.sort_order, "created_at": favorite.created_at, "updated_at": favorite.updated_at }),
            )
        }));
        // A favorite the merge gave someone, so undoing it removes only that.
        changes.extend(favorites.created_for.into_iter().map(|user_id| {
            MergeChange::new(
                "favorites",
                "favorite",
                json!({ "user_id": user_id, "entity_type": "crm_company", "entity_id": survivor }),
                Value::Null,
            )
        }));

        let members = sqlx::query_scalar!(
            "SELECT user_id FROM team_user WHERE team_id = $1 ORDER BY user_id",
            team
        )
        .fetch_all(&mut **tx)
        .await
        .map_err(db)?;
        let lists = saved_views::merge::retarget_crm_list_companies_in(
            &mut *tx,
            team,
            &members,
            targets.sources(),
            survivor,
        )
        .await
        .map_err(db)?;
        changes.extend(lists.into_iter().map(|list| {
            MergeChange::new(
                "saved_views",
                "saved_view",
                json!({ "id": list.view_id }),
                json!({ "config": list.previous_config, "revision": list.previous_revision }),
            )
        }));

        changes.extend(
            CompaniesRepositoryImpl::delete_merged_companies(&mut *tx, team, targets.sources())
                .await?,
        );

        let committed_at = chrono::Utc::now();
        let dropped = review
            .preview
            .conflicts
            .iter()
            .flat_map(|conflict| {
                conflict
                    .dropped
                    .iter()
                    .map(move |dropped| DroppedPropertyValue {
                        property: conflict.property_id.to_string(),
                        record: dropped.record_id.to_string(),
                        value: serde_json::to_value(&dropped.value).unwrap_or(Value::Null),
                    })
            })
            .collect();
        let entry = Activity::from_domain(
            merge_id,
            0,
            Actor::new_from_user(scope.actor.clone()),
            None,
            CompanyMerged {
                company_id: survivor.to_string(),
                merge: RecordMerge {
                    merge_id,
                    merged: review
                        .preview
                        .sources
                        .iter()
                        .map(|source| MergedRecordName {
                            id: source.id.to_string(),
                            name: Some(source.name.clone()),
                        })
                        .collect(),
                    dropped,
                },
            },
            committed_at,
        );
        activity::outbound::pg_activity_repo::insert_activities(&mut **tx, &[entry])
            .await
            .map_err(db)?;

        // Private values a merge drops are kept only here.
        for dropped in review.values.dropped.iter() {
            changes.push(MergeChange::new(
                "properties",
                "dropped_value",
                json!({ "record_id": dropped.record_id, "property_definition_id": dropped.property_id }),
                serde_json::to_value(&dropped.value).unwrap_or(Value::Null),
            ));
        }
        record_changes(&mut *tx, merge_id, &changes).await?;

        let outcome = MergeOutcome {
            merge_id,
            record_type: MergeRecordType::Company,
            survivor_id: survivor,
            merged_ids: targets.sources().to_vec(),
            committed_at,
        };
        Ok((outcome, written))
    }
}

impl<Databases> RecordMergeRepository for PgRecordMergeRepository<Databases>
where
    Databases: DatabaseStorageTransactions<Transaction = Transaction<'static, Postgres>>,
{
    #[tracing::instrument(name = "crm.merge.preview_read", skip_all, fields(team_id = %scope.team_id), err)]
    async fn preview(
        &self,
        scope: &MergeScope,
        targets: &MergeTargets,
    ) -> Result<MergePreview, MergeError> {
        if targets.record_type() != MergeRecordType::Company {
            return Err(MergeError::Invalid("contacts can't be merged yet".into()));
        }
        let mut tx = self.pool.begin().await.map_err(db)?;
        // One snapshot for every read, without taking a commit's locks.
        sqlx::query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        let state =
            CompaniesRepositoryImpl::company_merge_state(&mut tx, scope.team_id, targets).await?;
        let facts = Self::company_facts(&mut tx, scope.team_id, targets, state, false).await?;
        tx.rollback().await.map_err(db)?;
        Ok(company_review(targets, &facts).preview)
    }

    #[tracing::instrument(name = "crm.merge.commit_write", skip_all, fields(team_id = %scope.team_id), err)]
    async fn commit(
        &self,
        scope: &MergeScope,
        command: &MergeCommand,
    ) -> Result<MergeCommitted, MergeError> {
        if command.targets.record_type() != MergeRecordType::Company {
            return Err(MergeError::Invalid("contacts can't be merged yet".into()));
        }
        let fingerprint =
            plan::request_fingerprint(&command.targets, &command.revision, command.sharing_rules);
        let mut tx = self.pool.begin().await.map_err(db)?;
        // A slow merge fails instead of holding the team's CRM writers.
        sqlx::query!("SET LOCAL lock_timeout = '5s'")
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        sqlx::query!("SET LOCAL statement_timeout = '60s'")
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        // Another request with this key waits here for the privacy lock, then
        // finds the committed merge instead of records already merged.
        CompaniesRepositoryImpl::lock_merge_privacy(&mut tx, scope.team_id).await?;
        if let Some(outcome) = replayed(&mut tx, scope, command.request_key, &fingerprint).await? {
            tx.rollback().await.map_err(db)?;
            return Ok(MergeCommitted {
                outcome,
                replayed: true,
                changed_properties: Vec::new(),
            });
        }

        // The receipt's role can be gone by now: a demotion committed before
        // this read stops the merge, and the row lock holds off a later one.
        let admin = sqlx::query_scalar!(
            r#"SELECT team_role IN ('admin','owner') AS "admin!" FROM team_user
               WHERE team_id = $1 AND user_id = $2 FOR SHARE"#,
            scope.team_id,
            scope.actor.as_ref(),
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?;
        if admin != Some(true) {
            return Err(MergeError::PermissionRequired);
        }

        let merge_id = Uuid::now_v7();
        sqlx::query!(
            r#"INSERT INTO crm_merges (id, team_id, user_id, record_type, request_key, request_fingerprint,
                                       survivor_id, source_ids, result)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}'::jsonb)"#,
            merge_id,
            scope.team_id,
            scope.actor.as_ref(),
            command.targets.record_type().as_str(),
            command.request_key,
            fingerprint,
            command.targets.survivor(),
            command.targets.sources(),
        )
        .execute(&mut *tx)
        .await
        .map_err(db)?;

        let (outcome, changed_properties) = self
            .commit_company(&mut tx, scope, command, merge_id)
            .await?;
        sqlx::query!(
            "UPDATE crm_merges SET result = $2 WHERE id = $1",
            merge_id,
            serde_json::to_value(&outcome)
                .map_err(|error| CrmError::StorageLayerError(error.into()))?,
        )
        .execute(&mut *tx)
        .await
        .map_err(db)?;
        // Last, so a value attached while the merge ran is refused rather
        // than left on an id that no longer names a company.
        let sources: Vec<String> = command
            .targets
            .sources()
            .iter()
            .map(Uuid::to_string)
            .collect();
        if property_merge::values_remain_in(&mut tx, PropertyEntityType::Company, &sources)
            .await
            .map_err(db)?
        {
            return Err(MergeError::PreviewStale);
        }
        tx.commit().await.map_err(db)?;
        Ok(MergeCommitted {
            outcome,
            replayed: false,
            changed_properties,
        })
    }
}

/// Pipeline grants as the pipeline list reads them.
pub struct PipelineGrants<A>(pub Arc<A>);

#[async_trait::async_trait]
impl<A: entity_access::domain::ports::AccessiblePipelines>
    crate::domain::record_merge::service::MergePipelineAccess for PipelineGrants<A>
{
    async fn readable(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
        pipelines: &[Uuid],
    ) -> Result<std::collections::HashSet<Uuid>, MergeError> {
        let grants = self
            .0
            .pipelines_access(user, pipelines)
            .await
            .map_err(|error| CrmError::StorageLayerError(anyhow::anyhow!(error)))?;
        Ok(grants.into_keys().collect())
    }
}

/// Entity access as the properties API decides it before showing an
/// entity's properties. A failed check counts as no access, so a review
/// never counts what it couldn't confirm.
pub struct ReferenceGrants<A>(
    pub properties::outbound::permission_service::PermissionServiceImpl<A>,
);

impl<A: entity_access::domain::ports::EntityAccessService> ReferenceGrants<A> {
    /// Check access through `access`, reading owners from `pool`.
    pub fn new(pool: PgPool, access: Arc<A>) -> Self {
        Self(properties::outbound::permission_service::PermissionServiceImpl::new(pool, access))
    }
}

#[async_trait::async_trait]
impl<A: entity_access::domain::ports::EntityAccessService>
    crate::domain::record_merge::service::MergeReferenceAccess for ReferenceGrants<A>
{
    #[tracing::instrument(name = "crm.merge.reference_access", skip_all, fields(entities = entities.len(), readable = tracing::field::Empty))]
    async fn readable(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
        entities: &[(PropertyEntityType, String)],
    ) -> Result<std::collections::HashSet<(PropertyEntityType, String)>, MergeError> {
        use properties::domain::ports::PermissionService;
        let mut readable = std::collections::HashSet::new();
        for chunk in entities.chunks(8) {
            let checks = futures::future::join_all(chunk.iter().map(|(entity_type, entity_id)| {
                self.0.mint_view_receipt(
                    Some(user),
                    entity_id,
                    properties::domain::model::canonical_entity_type(*entity_type),
                )
            }))
            .await;
            for ((entity_type, entity_id), check) in chunk.iter().zip(checks) {
                if check.is_ok() {
                    readable.insert((*entity_type, entity_id.clone()));
                }
            }
        }
        tracing::Span::current().record("readable", readable.len());
        Ok(readable)
    }
}

/// Merging is on only for users the rollout flag names. Missing or failed
/// flags keep it off.
pub struct FlaggedMerge<F>(pub F);

impl<F> std::fmt::Debug for FlaggedMerge<F> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FlaggedMerge").finish_non_exhaustive()
    }
}

#[async_trait::async_trait]
impl<F: feature_flags::FeatureFlags + Send + Sync> crate::domain::record_merge::service::MergeGate
    for FlaggedMerge<F>
{
    #[tracing::instrument(name = "crm.merge.availability", skip_all)]
    async fn enabled_for(&self, user: macro_user_id::user_id::MacroUserIdStr<'_>) -> bool {
        match self.0.load(&user).await {
            Ok(flags) => flags.is_enabled(crate::domain::record_merge::MERGE_FLAG),
            Err(error) => {
                tracing::warn!(error = ?error, "failed to load the merge flag");
                false
            }
        }
    }
}

/// Publishes the property rows a merge wrote, as the property service does
/// after its own writes, so search and open lists catch up. The events carry
/// no actor: a merge's rewrites are not edits anyone's activity should show.
pub struct PropertyMergeEffects<Broker>(pub Broker);

impl<Broker> crate::domain::record_merge::service::MergeEffects for PropertyMergeEffects<Broker>
where
    Broker: macro_event_broker::MacroEventBroker + Send + Sync,
{
    fn properties_changed(&self, changes: &[ChangedEntityProperty]) {
        use properties::domain::events::{EntityPropertyUpdatedMetadata, PropertyMacroEvent};
        for change in changes {
            let event =
                PropertyMacroEvent::entity_property_updated(EntityPropertyUpdatedMetadata {
                    entity_property_id: change.entity_property_id,
                    entity_id: change.entity_id.clone(),
                    entity_type: change.entity_type,
                    property_definition_id: change.property_definition_id,
                    actor_user_id: None,
                    actor: None,
                    on_behalf_of: None,
                    source: None,
                    inherited_from_project: None,
                    value: change.value.clone(),
                    previous_value: change.previous_value.clone(),
                    updated_at: change.updated_at,
                });
            drop(self.0.send_event(&event).inspect_err(|error| {
                tracing::error!(error = ?error, "failed to schedule a merged property's event");
            }));
        }
    }
}
