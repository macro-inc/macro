//! Store derived columns' cells: read the rows' inputs inside the batch's
//! transaction, let the domain compute each row's values, and write every
//! derived column in one statement.

use super::*;
use crate::domain::derivation::Derivation;

impl<Properties> PgCellStore<Properties>
where
    Properties: DatabaseCellWriter<Transaction = Transaction<'static, Postgres>>,
{
    /// Store `derivation`'s cells on `rows` from the cells the batch has
    /// left them, answering whether a stored cell changed.
    ///
    /// Every batch writing a table holds its version row `FOR UPDATE` until
    /// it commits, and an update holds its rows' locks too, so the inputs
    /// read here cannot change before the derived values are stored: two
    /// people editing different inputs of one row run one after the other,
    /// and the later reads the earlier's value.
    pub(super) async fn derive(
        &self,
        transaction: &mut Transaction<'static, Postgres>,
        derivation: &Derivation,
        rows: &[RowId],
    ) -> Result<bool, PgCellStoreError> {
        if rows.is_empty() {
            return Ok(false);
        }
        let entity_ids = journal::entity_ids(rows);
        let stored = self
            .properties
            .entity_values_in(
                transaction,
                EntityType::DatabaseRow,
                &entity_ids,
                Some(&derivation.inputs()),
            )
            .await
            .map_err(cells_error)?;
        let mut inputs = journal::by_row(stored);
        let mut columns: HashMap<PropertyDefinitionId, Vec<(String, Option<PropertyValue>)>> =
            HashMap::new();
        for (row, entity_id) in rows.iter().zip(entity_ids) {
            let cells = inputs.remove(row).unwrap_or_default();
            for (definition, value) in derivation.cells(&cells) {
                columns
                    .entry(definition)
                    .or_default()
                    .push((entity_id.clone(), value));
            }
        }
        let mut changed = 0;
        for (definition, values) in columns {
            changed += self
                .properties
                .set_entity_values_in(transaction, EntityType::DatabaseRow, definition, &values)
                .await
                .map_err(cells_error)?;
        }
        Ok(changed > 0)
    }
}
