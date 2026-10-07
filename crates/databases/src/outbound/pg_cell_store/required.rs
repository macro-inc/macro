//! Recheck required cells against the final transaction state while table locks
//! are held. Properties supplies values through its transactional port.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use super::*;
use crate::domain::models::{ColumnId, cell_has_value};

impl<Properties> PgCellStore<Properties>
where
    Properties: DatabaseCellWriter<Transaction = Transaction<'static, Postgres>>,
{
    pub(super) async fn check_required_cells(
        &self,
        transaction: &mut Transaction<'static, Postgres>,
        writes: &Writes,
        inserted: &[Vec<RowId>],
    ) -> Result<Option<WritesOutcome>, PgCellStoreError> {
        // A schema change checks the whole table. Ordinary writes check only
        // their affected rows; optional tables never load any cell values.
        let mut scopes: BTreeMap<TableId, (usize, Option<BTreeSet<RowId>>)> = BTreeMap::new();
        for (index, (write, inserted)) in writes.writes.iter().zip(inserted).enumerate() {
            let (table, rows) = match write {
                Write::CreateColumn { column, .. } => (column.table_id, None),
                Write::ReplaceColumn { table_id, .. } => (*table_id, None),
                Write::InsertRows { table_id, .. } => {
                    (*table_id, Some(inserted.iter().copied().collect()))
                }
                Write::UpdateRows { table_id, rows } => {
                    (*table_id, Some(rows.iter().map(|(row, _)| *row).collect()))
                }
                Write::MoveCard { table_id, row, .. } => (*table_id, Some(BTreeSet::from([*row]))),
                _ => continue,
            };
            scopes
                .entry(table)
                .and_modify(|(first, scope)| {
                    if let Some(existing) = scope {
                        match &rows {
                            Some(rows) => existing.extend(rows),
                            None => {
                                *scope = None;
                                *first = index;
                            }
                        }
                    }
                })
                .or_insert((index, rows));
        }
        for (table, (write, rows)) in scopes {
            let columns = sqlx::query!(
                "SELECT id, property_definition_id FROM database_columns WHERE table_id = $1 AND NOT nullable ORDER BY id",
                table.into_uuid()
            ).fetch_all(&mut **transaction).await?;
            if columns.is_empty() {
                continue;
            }
            let definitions: Vec<_> = columns
                .iter()
                .map(|column| column.property_definition_id)
                .collect();
            let row_ids: Option<Vec<_>> =
                rows.map(|rows| rows.into_iter().map(RowId::into_uuid).collect());
            let mut after: Option<uuid::Uuid> = None;
            loop {
                let page = sqlx::query_scalar!(
                    "SELECT id FROM database_rows WHERE table_id = $1
                     AND ($2::uuid[] IS NULL OR id = ANY($2))
                     AND ($3::uuid IS NULL OR id > $3) ORDER BY id LIMIT 1000",
                    table.into_uuid(),
                    row_ids.as_deref(),
                    after
                )
                .fetch_all(&mut **transaction)
                .await?;
                if page.is_empty() {
                    break;
                }
                let entities: Vec<_> = page.iter().map(ToString::to_string).collect();
                let present: HashSet<_> = self
                    .properties
                    .entity_values_in(
                        transaction,
                        EntityType::DatabaseRow,
                        &entities,
                        Some(&definitions),
                    )
                    .await
                    .map_err(cells_error)?
                    .into_iter()
                    .filter(|(_, _, value)| cell_has_value(value))
                    .map(|(row, definition, _)| (row, definition))
                    .collect();
                for (row, entity) in page.iter().zip(&entities) {
                    for column in &columns {
                        if !present.contains(&(entity.clone(), column.property_definition_id)) {
                            return Ok(Some(WritesOutcome::MissingRequiredCell {
                                write,
                                column: ColumnId::from_uuid(column.id),
                                row: RowId::from_uuid(*row),
                            }));
                        }
                    }
                }
                after = page.last().copied();
            }
        }
        Ok(None)
    }
}
