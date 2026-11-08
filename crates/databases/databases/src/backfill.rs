//! Store the cells of formula columns created before their values were
//! stored: one batch per table through the cell store, so each table is
//! derived under its own lock and only bumps its version when a cell
//! changed. Running it again changes nothing.

use anyhow::Context as _;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use properties::outbound::properties_pg_repo::PropertiesPgRepo;
use sqlx::PgPool;

use crate::domain::catalog::{ColumnEntry, StorageTable};
use crate::domain::derivation::Derivation;
use crate::domain::journal::JournalPlan;
use crate::domain::models::{DatabaseId, TableId, Writes, WritesOutcome};
use crate::domain::ports::{CellStore, ColumnDefinitionStore, DatabasesRepo};
use crate::outbound::pg_cell_store::PgCellStore;
use crate::outbound::pg_databases_repo::PgDatabasesRepo;
use crate::outbound::pg_definition_store::PgDefinitionStore;

/// What backfilling one table did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableBackfill {
    /// The table's rows.
    pub rows: usize,
    /// Whether a cell changed, and so the table's version moved.
    pub changed: bool,
}

/// Every table of a live database with a formula column, by database.
pub async fn tables_with_formulas(pool: &PgPool) -> anyhow::Result<Vec<(DatabaseId, TableId)>> {
    Ok(
        PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
            .tables_with_derived_columns()
            .await?,
    )
}

/// Derive every formula column of one table on all its rows, as the
/// database's owner.
pub async fn backfill_table(
    pool: &PgPool,
    database_id: DatabaseId,
    table_id: TableId,
) -> anyhow::Result<TableBackfill> {
    let properties = PropertiesPgRepo::new(pool.clone());
    let repository = PgDatabasesRepo::new(pool.clone(), properties.clone());
    let (database, tables) = repository
        .get_database(database_id)
        .await?
        .context("the database is gone")?;
    let table = tables
        .into_iter()
        .find(|table| table.id == table_id)
        .context("the table is gone")?;
    let columns = repository.columns_for_tables(&[table_id]).await?;
    let definitions = PgDefinitionStore::new(pool.clone(), properties.clone())
        .definitions(
            &columns
                .iter()
                .map(|column| column.property_definition_id)
                .collect::<Vec<_>>(),
        )
        .await?;
    let columns = columns
        .into_iter()
        .map(|column| {
            let definition = definitions
                .iter()
                .find(|definition| definition.definition.id == column.property_definition_id)
                .cloned()
                .with_context(|| format!("column {} has no definition", column.id))?;
            Ok(ColumnEntry {
                column,
                definition,
                writable: false,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let rows = repository.row_refs(table_id).await?.len();
    let entry = StorageTable {
        table,
        columns,
        views: Vec::new(),
    };
    let Some(derivation) = Derivation::every(&entry) else {
        return Ok(TableBackfill {
            rows,
            changed: false,
        });
    };
    let owner = MacroUserIdStr::parse_from_str(&database.owner_id)
        .context("the database's owner is not a user id")?
        .into_owned();
    let outcome = PgCellStore::new(pool.clone(), properties)
        .apply_writes(&Writes {
            database_id,
            created_by: owner,
            writes: Vec::new(),
            related_rows: Vec::new(),
            expected_versions: Vec::new(),
            journal: JournalPlan::default(),
            derivations: vec![derivation],
        })
        .await?;
    match outcome {
        WritesOutcome::Applied { table_versions, .. } => Ok(TableBackfill {
            rows,
            changed: table_versions.contains_key(&table_id),
        }),
        refused => anyhow::bail!("the cell store refused the batch: {refused:?}"),
    }
}
