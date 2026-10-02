//! The change journal: every committed batch, per table version it produced,
//! with its ops, the inverse that undoes them, and which rows and columns it
//! touched. The adapter reads the before-image under the batch's table locks;
//! everything here is pure.

mod entries;
mod guard;
mod invert;
#[cfg(test)]
mod test;

use std::collections::{BTreeMap, BTreeSet};

use bot_id::BotId;
use chrono::{DateTime, Utc};
use models_databases::position::Position;
use models_databases::views::{CardPosition, DatabaseView, ViewId};
use models_databases::{
    CellValue, ChangeId, ColumnId, ColumnKind, DatabaseId, DatabaseOp, EntityRef, OptionId,
    OptionRef, RowId, TableId, TableVersion,
};
use models_properties::service::property_value::PropertyValue;
use serde::{Deserialize, Serialize};

pub use entries::{entries, reads};
pub use guard::{Current, Guarded, SkippedCell, UndoRefusal, guard};
pub use invert::{Planned, invert};

use crate::domain::catalog::entity_kind;
use crate::domain::models::PropertyDefinitionId;

/// Current persisted inverse format; older formats lack restoration metadata.
pub const INVERSE_FORMAT_VERSION: u8 = 1;

/// What undoes one change, as the journal stores it (`database_changes.inverse`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeInverse {
    /// Inverse format. Missing in legacy records, which are not safe to replay.
    #[serde(default)]
    pub format_version: u8,
    /// True when the original write affected state this inverse cannot restore.
    #[serde(default)]
    pub incomplete: bool,
    /// Placement metadata for columns recreated by the inverse.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub restored_columns: BTreeMap<ColumnId, RestoredColumn>,
    /// The ops that undo the change, to apply in order: the change's ops
    /// inverted newest first, then any order they disturbed put back.
    pub ops: Vec<DatabaseOp>,
    /// For each row insert among `ops`, by its index there, the ids and
    /// positions of the rows it puts back. A row insert mints new ids, so
    /// the rows a delete removed come back under theirs only through these.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub restored_rows: BTreeMap<usize, Vec<RestoredRow>>,
    /// For each type change among `ops`, by its index there, the definition
    /// the column was bound to before: a type change mints a new definition
    /// and leaves the old one, with its options, unbound, so binding it back
    /// and writing the old cells (`before`) restores the column exactly.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub rebinds: BTreeMap<usize, PropertyDefinitionId>,
    /// Every cell the change touched as it was before, empty cells left
    /// out: a cell's prior value, readable without replay.
    pub before: CellImage,
    /// Every cell the change wrote, as it wrote it; cleared cells left out.
    pub after: CellImage,
}

impl Default for ChangeInverse {
    fn default() -> Self {
        Self {
            format_version: INVERSE_FORMAT_VERSION,
            incomplete: false,
            restored_columns: BTreeMap::new(),
            ops: Vec::new(),
            restored_rows: BTreeMap::new(),
            rebinds: BTreeMap::new(),
            before: CellImage::default(),
            after: CellImage::default(),
        }
    }
}

/// Cells by row, then column.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct CellImage {
    /// The cells.
    pub cells: BTreeMap<RowId, BTreeMap<ColumnId, CellValue>>,
}

impl CellImage {
    /// One row's cells; `None` when it has none here.
    pub fn row(&self, row: RowId) -> Option<&BTreeMap<ColumnId, CellValue>> {
        self.cells.get(&row)
    }
}

/// What an undo batch puts back that ops alone cannot: the ids and positions
/// of the rows its inserts restore, and the definitions its type changes
/// bind back, each by the op's index in the batch.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Restoration {
    /// Rows an undo may remove only without surviving incoming relations.
    pub unreferenced_rows: BTreeSet<RowId>,
    /// Placement metadata that cannot be expressed by binding a property.
    pub columns: BTreeMap<ColumnId, RestoredColumn>,
    /// Options an undo may remove only while no entity selects them.
    pub unused_options: BTreeSet<OptionId>,
    /// The rows each row insert puts back.
    pub rows: BTreeMap<usize, Vec<RestoredRow>>,
    /// The definition each type change binds back.
    pub rebinds: BTreeMap<usize, PropertyDefinitionId>,
}

impl ChangeInverse {
    /// What applying the inverse's ops puts back beyond them.
    pub fn restoration(&self) -> Restoration {
        Restoration {
            unreferenced_rows: BTreeSet::new(),
            columns: self.restored_columns.clone(),
            unused_options: BTreeSet::new(),
            rows: self.restored_rows.clone(),
            rebinds: self.rebinds.clone(),
        }
    }
}

/// Placement state to restore along with a deleted column's definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RestoredColumn {
    /// Original kind, including a relation's target.
    pub kind: Option<ColumnKind>,
    /// Whether the first value should still infer a type.
    pub infer_type: bool,
}

/// A row a delete removed: its id and place.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RestoredRow {
    /// Its id.
    pub id: RowId,
    /// Its position in its table.
    pub position: Position,
}

/// How a change touched a row.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    strum::EnumString,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum RowChangeKind {
    /// The row was added.
    Insert,
    /// Some of its cells were written.
    Update,
    /// The row was removed.
    Delete,
}

/// How a change touched a column.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    strum::EnumString,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ColumnChangeKind {
    /// It was added.
    Create,
    /// It was renamed.
    Rename,
    /// Its type changed, and its cells with it.
    ChangeType,
    /// It was removed.
    Delete,
    /// It gained options.
    AddOptions,
    /// One of its options was relabelled or recoloured.
    UpdateOption,
    /// One of its options was removed, and taken out of its cells.
    DeleteOption,
    /// The table's columns were reordered.
    Reorder,
    /// Its first value settled its type.
    InferType,
    /// A column of another table this one relates to, or shares a property
    /// with, changed, which changes what this table shows.
    Related,
}

/// One row a change touched, and which of its columns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowTouch {
    /// The row.
    pub row: RowId,
    /// How.
    pub kind: RowChangeKind,
    /// The columns written; for a delete, those the row had values in.
    pub columns: Vec<ColumnId>,
}

/// One column a change touched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnTouch {
    /// The column.
    pub column: ColumnId,
    /// How.
    pub kind: ColumnChangeKind,
}

/// One change to record: the version of one table a batch produced.
#[derive(Debug, Clone, PartialEq)]
pub struct JournalEntry {
    /// The table's database.
    pub database_id: DatabaseId,
    /// The table.
    pub table: TableId,
    /// The version the change produced.
    pub version: TableVersion,
    /// The batch's ops on the table, as sent.
    pub ops: Vec<DatabaseOp>,
    /// What undoes them.
    pub inverse: ChangeInverse,
    /// The rows it touched.
    pub rows: Vec<RowTouch>,
    /// The columns it touched.
    pub columns: Vec<ColumnTouch>,
}

/// Who made a batch, as the journal records it.
#[derive(Debug, Clone, PartialEq)]
pub struct JournalActor {
    /// The user acting; `None` for an internal caller.
    pub user: Option<String>,
    /// The agent acting for them, if one is.
    pub acting_bot: Option<BotId>,
}

/// What the planner knows of a batch that its journal needs: the ops as
/// sent, and the schema they were planned against.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct JournalPlan {
    /// The ops, in order; `Writes::writes` holds one write per op.
    pub ops: Vec<DatabaseOp>,
    /// The database's schema the ops were planned against.
    pub schema: SchemaImage,
    /// The agent acting for the batch's user, if one is.
    pub acting_bot: Option<BotId>,
}

impl JournalPlan {
    /// The versions the schema was read at, of the tables whose schema or
    /// views the batch changes: the batch applies only if they are still
    /// there under its locks, so its inverse is built from the schema it
    /// changes. Row writes read their before-image under the locks instead.
    pub fn read_versions(&self) -> Vec<(TableId, TableVersion)> {
        let mut tables: Vec<TableId> = self
            .ops
            .iter()
            .filter(|op| reads_schema(op))
            .flat_map(|op| match op {
                DatabaseOp::ReorderTables { order } => order.clone(),
                op => op.table().into_iter().collect(),
            })
            .collect();
        tables.sort();
        tables.dedup();
        tables
            .into_iter()
            .filter_map(|table| {
                self.schema
                    .tables
                    .iter()
                    .find(|image| image.id == table)
                    .map(|image| (table, image.version))
            })
            .collect()
    }
}

/// Whether an op's inverse reads the schema it was planned against.
fn reads_schema(op: &DatabaseOp) -> bool {
    !matches!(
        op,
        DatabaseOp::Rows { .. }
            | DatabaseOp::View {
                change: models_databases::ViewChange::MoveCard { .. },
                ..
            }
    )
}

/// A database's schema as a batch's planner read it.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SchemaImage {
    /// Its tables, in tab order.
    pub tables: Vec<TableImage>,
    /// Their columns, each table's in display order.
    pub columns: Vec<ColumnImage>,
    /// Their views, each table's in order.
    pub views: Vec<DatabaseView>,
}

impl SchemaImage {
    /// A column.
    pub fn column(&self, column: ColumnId) -> Option<&ColumnImage> {
        self.columns.iter().find(|image| image.id == column)
    }

    /// A table's columns, in order.
    pub fn columns_of(&self, table: TableId) -> impl Iterator<Item = &ColumnImage> {
        self.columns
            .iter()
            .filter(move |image| image.table == table)
    }

    /// The column of a table bound to a definition.
    pub fn column_for(
        &self,
        table: TableId,
        definition: PropertyDefinitionId,
    ) -> Option<&ColumnImage> {
        self.columns_of(table)
            .find(|image| image.definition == definition)
    }

    /// A view.
    pub fn view(&self, view: ViewId) -> Option<&DatabaseView> {
        self.views.iter().find(|image| image.id == view)
    }

    /// A table.
    pub fn table(&self, table: TableId) -> Option<&TableImage> {
        self.tables.iter().find(|image| image.id == table)
    }
}

/// A table as the planner read it.
#[derive(Debug, Clone, PartialEq)]
pub struct TableImage {
    /// The table.
    pub id: TableId,
    /// Its name.
    pub name: String,
    /// Its version when read.
    pub version: TableVersion,
}

/// A column as the planner read it.
#[derive(Debug, Clone, PartialEq)]
pub struct ColumnImage {
    /// Whether a first value still determines the column's type.
    pub infer_type: bool,
    /// The column.
    pub id: ColumnId,
    /// Its table.
    pub table: TableId,
    /// The name it goes by.
    pub name: String,
    /// Its definition's own name, which it goes by when bound afresh.
    pub definition_name: String,
    /// The definition it is bound to.
    pub definition: PropertyDefinitionId,
    /// Its type; `None` for a stored type no op can name.
    pub kind: Option<ColumnKind>,
    /// Its options, in order.
    pub options: Vec<OptionImage>,
}

/// An option as the planner read it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OptionImage {
    /// The option.
    pub id: OptionId,
    /// Its label.
    pub label: String,
    /// Its colour.
    pub color: Option<String>,
}

/// What a batch touches, read under its locks before it writes.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Before {
    /// Option removals with uses outside the captured table's cells.
    pub incomplete_options: BTreeSet<OptionId>,
    /// The schema the batch was planned against.
    pub schema: SchemaImage,
    /// Every existing row the batch updates, deletes or moves.
    pub rows: BTreeMap<RowId, RowImage>,
    /// Every cell of each column the batch removes, retypes or removes an
    /// option of, by row; empty cells left out.
    pub column_cells: BTreeMap<ColumnId, BTreeMap<RowId, CellValue>>,
    /// Where the cards of each board the batch moves a card on sat.
    pub cards: BTreeMap<ViewId, Vec<CardPosition>>,
}

/// A row as it was.
#[derive(Debug, Clone, PartialEq)]
pub struct RowImage {
    /// Its table.
    pub table: TableId,
    /// Its position.
    pub position: Position,
    /// Its cells; empty ones left out.
    pub cells: BTreeMap<ColumnId, CellValue>,
}

/// What the adapter must read under the batch's locks for its before-image.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Reads {
    /// The existing rows the batch updates, deletes or moves.
    pub rows: Vec<RowId>,
    /// Each column whose every cell the batch may change, with its table and
    /// definition.
    pub columns: Vec<(TableId, ColumnId, PropertyDefinitionId)>,
    /// The boards the batch moves a card on.
    pub boards: Vec<ViewId>,
}

/// A stored value as an op writes it: options by id, a relation's rows by
/// id. `None` for a reference no op can name.
pub fn cell_value(value: &PropertyValue) -> Option<CellValue> {
    Some(match value {
        PropertyValue::Str(text) => CellValue::Text(text.clone()),
        PropertyValue::Num(number) => CellValue::Number(*number),
        PropertyValue::Bool(checked) => CellValue::Boolean(*checked),
        PropertyValue::Date(date) => CellValue::Date(*date),
        PropertyValue::Link(urls) => CellValue::Link(urls.clone()),
        PropertyValue::SelectOption(options) => CellValue::Options(
            options
                .iter()
                .map(|option| OptionRef::Id(OptionId::from_uuid(*option)))
                .collect(),
        ),
        PropertyValue::EntityRef(references) => {
            if references.iter().all(|reference| {
                reference.entity_type == models_properties::EntityType::DatabaseRow
            }) && !references.is_empty()
            {
                CellValue::Rows(
                    references
                        .iter()
                        .map(|reference| reference.entity_id.parse().ok())
                        .collect::<Option<_>>()?,
                )
            } else {
                CellValue::Entities(
                    references
                        .iter()
                        .map(|reference| {
                            Some(EntityRef {
                                entity_type: entity_kind(reference.entity_type)?,
                                entity_id: reference.entity_id.clone(),
                            })
                        })
                        .collect::<Option<_>>()?,
                )
            }
        }
    })
}

/// A row's stored cells, by definition, as the before-image keeps them: by
/// the column of its table each definition is bound to.
pub fn row_cells(
    schema: &SchemaImage,
    table: TableId,
    cells: &std::collections::HashMap<PropertyDefinitionId, PropertyValue>,
) -> BTreeMap<ColumnId, CellValue> {
    cells
        .iter()
        .filter_map(|(definition, value)| {
            let column = schema.column_for(table, *definition)?;
            Some((column.id, cell_value(value)?))
        })
        .collect()
}

/// The entry of a column whose first value settled its type: the column
/// changed, and nothing else; no op undoes it.
pub fn settled_column(
    database_id: DatabaseId,
    table: TableId,
    version: TableVersion,
    column: ColumnId,
) -> JournalEntry {
    JournalEntry {
        database_id,
        table,
        version,
        ops: Vec::new(),
        inverse: ChangeInverse::default(),
        rows: Vec::new(),
        columns: vec![ColumnTouch {
            column,
            kind: ColumnChangeKind::InferType,
        }],
    }
}

/// The entry of a table made whole by an import: its columns and rows,
/// created together. Undoing it removes the table.
pub fn created_table(
    database_id: DatabaseId,
    table: TableId,
    version: TableVersion,
    columns: &[ColumnId],
    rows: &[RowId],
) -> JournalEntry {
    JournalEntry {
        database_id,
        table,
        version,
        ops: Vec::new(),
        inverse: ChangeInverse {
            ops: vec![DatabaseOp::Table {
                table,
                change: models_databases::TableChange::Delete,
            }],
            ..ChangeInverse::default()
        },
        rows: rows
            .iter()
            .map(|row| RowTouch {
                row: *row,
                kind: RowChangeKind::Insert,
                columns: columns.to_vec(),
            })
            .collect(),
        columns: columns
            .iter()
            .map(|column| ColumnTouch {
                column: *column,
                kind: ColumnChangeKind::Create,
            })
            .collect(),
    }
}

/// One change as the journal answers it.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredChange {
    /// Its id.
    pub id: ChangeId,
    /// The table.
    pub table: TableId,
    /// The version it produced.
    pub version: TableVersion,
    /// Who made it.
    pub actor: Option<String>,
    /// The agent acting for them, if one was.
    pub acting_bot: Option<String>,
    /// When.
    pub at: DateTime<Utc>,
    /// The ops, as sent.
    pub ops: Vec<DatabaseOp>,
    /// What undoes them.
    pub inverse: ChangeInverse,
}

/// One change of a row, as the journal indexes it.
#[derive(Debug, Clone, PartialEq)]
pub struct JournaledRowChange {
    /// The change.
    pub change: StoredChange,
    /// How it touched the row.
    pub kind: RowChangeKind,
    /// Which of the row's columns.
    pub columns: Vec<ColumnId>,
}

/// One change of a row, as its history shows it.
#[derive(Debug, Clone, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RowHistoryEntry {
    /// The change's id in the journal.
    #[schema(value_type = i64)]
    pub change: ChangeId,
    /// The table version it produced.
    #[schema(value_type = i64)]
    pub version: TableVersion,
    /// Who made it; `null` for an internal caller, or a removed user.
    #[schema(required = true)]
    pub actor: Option<String>,
    /// The agent acting for them, if one was.
    #[schema(required = true)]
    pub acting_bot: Option<String>,
    /// When it committed.
    pub at: DateTime<Utc>,
    /// How it touched the row.
    pub kind: RowChangeKind,
    /// The columns it wrote; for a removal, those the row had values in.
    #[schema(value_type = Vec<Uuid>)]
    pub columns: Vec<ColumnId>,
    /// Those columns' values before it, by column id; an empty cell is
    /// left out.
    #[schema(value_type = HashMap<String, CellValue>)]
    pub before: BTreeMap<ColumnId, CellValue>,
    /// Those columns' values it wrote, by column id; a cell it emptied is
    /// left out.
    #[schema(value_type = HashMap<String, CellValue>)]
    pub after: BTreeMap<ColumnId, CellValue>,
}

/// A row's history from its journaled changes, newest first, each with the
/// values of the columns it touched before and after it.
pub fn row_history(row: RowId, changes: Vec<JournaledRowChange>) -> Vec<RowHistoryEntry> {
    changes
        .into_iter()
        .map(|journaled| {
            let pick = |image: &CellImage| -> BTreeMap<ColumnId, CellValue> {
                image
                    .row(row)
                    .into_iter()
                    .flatten()
                    .filter(|(column, _)| journaled.columns.contains(column))
                    .map(|(column, value)| (*column, value.clone()))
                    .collect()
            };
            RowHistoryEntry {
                change: journaled.change.id,
                version: journaled.change.version,
                actor: journaled.change.actor.clone(),
                acting_bot: journaled.change.acting_bot.clone(),
                at: journaled.change.at,
                kind: journaled.kind,
                before: pick(&journaled.change.inverse.before),
                after: pick(&journaled.change.inverse.after),
                columns: journaled.columns,
            }
        })
        .collect()
}

/// One change with the rows and columns it touched, as an undo reads the
/// journal.
#[derive(Debug, Clone, PartialEq)]
pub struct ChangeRecord {
    /// The change.
    pub change: StoredChange,
    /// The rows it touched.
    pub rows: Vec<RowTouch>,
    /// The columns it touched.
    pub columns: Vec<ColumnTouch>,
}

/// What undoing a change did.
#[derive(Debug, Clone, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UndoOutcome {
    /// Everything the change did is undone.
    Reverted {
        /// The journal's changes the undo made, one per table version; undo
        /// one of them to redo.
        changes: Vec<crate::domain::models::CommittedChange>,
    },
    /// Some cells were changed by someone since, and were left alone; the
    /// rest is undone. With no changes, nothing was left to undo.
    Partial {
        /// The cells left alone, each with who changed it.
        skipped: Vec<SkippedCell>,
        /// The journal's changes the undo made.
        changes: Vec<crate::domain::models::CommittedChange>,
    },
    /// Nothing was undone.
    Refused {
        /// Why.
        reason: UndoRefusal,
        /// Whose change stands in the way, when one does.
        #[schema(required = true)]
        by: Option<String>,
    },
}

/// Most rows a table's changes answer one by one; past it, a reader reads the
/// table whole.
pub const MAX_TOUCHED_ROWS: usize = 500;

/// One version of a table's journal, with what it touched, as a refresh
/// reads it.
#[derive(Debug, Clone, PartialEq)]
pub struct VersionTouches {
    /// The version the change produced.
    pub version: TableVersion,
    /// The rows it touched, and how.
    pub rows: Vec<(RowId, RowChangeKind)>,
    /// The columns it touched, and how.
    pub columns: Vec<ColumnTouch>,
}

/// A row a table's changes since some version touched, and how it stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct TouchedRow {
    /// The row.
    #[schema(value_type = Uuid)]
    pub row: RowId,
    /// How it changed overall: added, written, or removed.
    pub kind: RowChangeKind,
}

/// A column a table's changes since some version touched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct TouchedColumn {
    /// The column.
    #[schema(value_type = Uuid)]
    pub column: ColumnId,
    /// How.
    pub kind: ColumnChangeKind,
}

/// What changed in a table since a version, for a reader holding it at
/// that version.
#[derive(Debug, Clone, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TableChanges {
    /// The version the changes reach.
    #[schema(value_type = i64)]
    pub version: TableVersion,
    /// Whether every version since is journaled; without it, read the table
    /// whole.
    pub complete: bool,
    /// Whether more rows changed than are listed; then read the table whole.
    pub truncated: bool,
    /// The rows that changed, each once, as they stand now: a row added
    /// and written is `insert`, one removed is `delete`, and one added and
    /// removed since is left out.
    pub rows: Vec<TouchedRow>,
    /// The columns that changed; any of them means the table's shape moved.
    pub columns: Vec<TouchedColumn>,
}

/// Fold a table's journal after `since`, oldest first, into what changed:
/// each row once, as it stands now. It is complete when the versions run
/// without a gap from `since`.
pub fn table_changes(since: TableVersion, versions: &[VersionTouches]) -> TableChanges {
    let mut expected = since.0;
    let mut complete = true;
    let mut rows: Vec<(RowId, Vec<RowChangeKind>)> = Vec::new();
    let mut columns: Vec<TouchedColumn> = Vec::new();
    for touches in versions {
        if touches.version.0 != expected + 1 {
            complete = false;
        }
        expected = touches.version.0;
        for (row, kind) in &touches.rows {
            match rows.iter_mut().find(|(held, _)| held == row) {
                Some((_, kinds)) => kinds.push(*kind),
                None => rows.push((*row, vec![*kind])),
            }
        }
        for touch in &touches.columns {
            let touched = TouchedColumn {
                column: touch.column,
                kind: touch.kind,
            };
            if !columns.contains(&touched) {
                columns.push(touched);
            }
        }
    }
    let rows: Vec<TouchedRow> = rows
        .into_iter()
        .filter_map(|(row, kinds)| {
            let inserted = kinds.first() == Some(&RowChangeKind::Insert);
            let deleted = kinds.last() == Some(&RowChangeKind::Delete);
            let kind = match (inserted, deleted) {
                (true, true) => return None,
                (_, true) => RowChangeKind::Delete,
                (true, false) => RowChangeKind::Insert,
                (false, false) => RowChangeKind::Update,
            };
            Some(TouchedRow { row, kind })
        })
        .collect();
    let truncated = rows.len() > MAX_TOUCHED_ROWS;
    TableChanges {
        version: TableVersion(expected),
        complete,
        truncated,
        rows: if truncated { Vec::new() } else { rows },
        columns,
    }
}
