//! Shared SQL pipeline. The domain selects read-only or interactive access;
//! executors enforce the resulting catalog and never choose caller policy.

use std::collections::{HashMap, HashSet};

use macro_event_broker::MacroEventBroker;

use super::{DatabasesServiceImpl, Loaded, MAX_SQL_LEN, ViewerCatalog, infra};
use crate::domain::catalog;
use crate::domain::events;
use crate::domain::models::{
    ApplyOutcome, ColumnConfig, DatabaseId, ExecOutcome, ExecRequest, QueryError, QueryResult,
    RawRowChange, RowChange, TableId, TableSource, TableVersion, Viewer,
};
use crate::domain::ports::{
    AccessDirectory, ColumnDefinitionStore, DatabasesRepo, MagicTables, SqlExecutor,
    TableEventPublisher,
};
use crate::domain::sugar::desugar;
use crate::domain::translate::translate;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum QueryMode {
    ReadOnly,
    ReadWrite,
}

impl<Repo, Defs, Magic, Exec, Events, Access, Broker>
    DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events, Access, Broker>
where
    Repo: DatabasesRepo,
    Defs: ColumnDefinitionStore,
    Magic: MagicTables,
    Exec: SqlExecutor,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    pub(super) async fn run_sql(
        &self,
        viewer: Viewer,
        req: ExecRequest,
        mode: QueryMode,
    ) -> Result<ExecOutcome, QueryError> {
        if req.sql.len() > MAX_SQL_LEN {
            return Err(QueryError::BudgetExceeded);
        }
        let ViewerCatalog {
            entries,
            mut catalog,
        } = self.build_catalog(&viewer).await?;
        // Query chips execute stored SQL as the viewer. Even an owner must
        // receive a read-only catalog on this surface; the SQL authorizer
        // enforces the same policy during execution.
        if mode == QueryMode::ReadOnly {
            for table in &mut catalog.tables {
                table.writable = false;
            }
        }
        let sql = desugar(&req.sql);

        let deps = {
            let catalog = catalog.clone();
            let sql = sql.clone();
            self.blocking(move |exec| exec.analyze(&catalog, &sql))
                .await?
        };

        // Fail early with a precise reason; the executor's authorizer enforces
        // the same policy during execution.
        let mut written_tables: Vec<TableId> = Vec::new();
        for (name, referenced) in &deps.tables {
            if !referenced.written {
                continue;
            }
            let schema = catalog
                .tables
                .iter()
                .find(|t| &t.sql_name == name || t.aliases.iter().any(|a| a == name))
                .ok_or_else(|| QueryError::Sql(format!("no such table: {name}")))?;
            if !schema.writable || &schema.sql_name != name {
                return Err(QueryError::ReadOnly(format!("table {name} is read-only")));
            }
            match schema.source {
                TableSource::UserTable(table_id) | TableSource::Junction { table_id, .. } => {
                    if !written_tables.contains(&table_id) {
                        written_tables.push(table_id);
                    }
                }
                TableSource::Magic(_) => {
                    return Err(QueryError::ReadOnly(format!("table {name} is read-only")));
                }
            }
        }

        let mut loaded = Loaded::default();
        let (tables, truncated_tables) = self
            .materialize_deps(&viewer, &entries, &deps, &mut loaded)
            .await?;
        let (results, raw_changes): (Vec<QueryResult>, Vec<RawRowChange>) = {
            let catalog = catalog.clone();
            let sql = sql.clone();
            self.blocking(move |exec| exec.execute(&catalog, tables, &sql))
                .await?
        };
        if mode == QueryMode::ReadOnly && !raw_changes.is_empty() {
            return Err(QueryError::ReadOnly("queries cannot change data".into()));
        }
        let changes = translate(raw_changes, &entries)?;
        self.validate_links(&changes, &entries, &mut loaded).await?;

        // A truncated magic table is a partial view of the world. Reading one
        // is merely incomplete (and reported as such); writing from one is
        // wrong — the statement's WHERE clause never saw the missing rows.
        if !written_tables.is_empty() && !truncated_tables.is_empty() {
            return Err(QueryError::TruncatedDependency(truncated_tables.join(", ")));
        }

        // A link edge belongs to both ends: the target table's rows gain (or
        // lose) a backlink, so its version moves too and compare-and-set
        // covers it.
        for change in &changes {
            let (RowChange::Link { column_id, .. } | RowChange::Unlink { column_id, .. }) = change
            else {
                continue;
            };
            let target = entries
                .iter()
                .find_map(|e| e.columns.iter().find(|c| c.column.id == *column_id))
                .and_then(|c| match &c.column.config {
                    Some(ColumnConfig::Link { table_id, .. }) => Some(*table_id),
                    _ => None,
                });
            if let Some(target) = target
                && !written_tables.contains(&target)
            {
                written_tables.push(target);
            }
        }

        let expected_versions: HashMap<TableId, TableVersion> = req
            .base_versions
            .unwrap_or_default()
            .into_iter()
            .filter(|(table_id, _)| written_tables.contains(table_id))
            .collect();
        let (inserted_row_ids, new_versions) = if changes.is_empty() {
            (Vec::new(), HashMap::new())
        } else {
            match self
                .repo
                .apply_changes(&viewer, &changes, &expected_versions)
                .await
                .map_err(infra)?
            {
                ApplyOutcome::Applied(applied) => applied,
                ApplyOutcome::VersionConflict { table_id } => {
                    return Err(QueryError::VersionConflict { table_id });
                }
            }
        };
        let database_of: HashMap<TableId, DatabaseId> = entries
            .iter()
            .map(|e| (e.table.id, e.table.database_id))
            .collect();
        self.publish(
            Some(events::Attribution::user(viewer.user_id.clone())),
            &database_of,
            &new_versions,
        )
        .await;

        let read_tables: Vec<TableId> = deps
            .tables
            .keys()
            .filter_map(|name| {
                entries
                    .iter()
                    .find(|e| {
                        catalog::entry_answers_to(e, name)
                            || e.junctions
                                .iter()
                                .any(|j| catalog::junction_answers_to(j, name))
                    })
                    .map(|e| e.table.id)
            })
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();

        // The version each read table was at when this statement materialized
        // it. Re-sending these as `base_versions` guards tables the follow-up
        // statement writes; versions for read-only dependencies are ignored.
        let read_versions: HashMap<TableId, TableVersion> = read_tables
            .iter()
            .filter_map(|table_id| {
                entries
                    .iter()
                    .find(|e| e.table.id == *table_id)
                    .map(|e| (*table_id, e.table.version))
            })
            .collect();

        Ok(ExecOutcome {
            results,
            changes_applied: changes.len(),
            inserted_row_ids,
            new_versions,
            read_database_ids: read_tables
                .iter()
                .filter_map(|table_id| database_of.get(table_id).copied())
                .collect::<HashSet<_>>()
                .into_iter()
                .collect(),
            read_tables,
            read_versions,
            truncated_tables,
        })
    }
}
