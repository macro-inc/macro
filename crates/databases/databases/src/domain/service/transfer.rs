use super::*;
use crate::domain::transfer::{
    DatabaseTransferRepo, DatabaseTransferService, ImportFingerprint, ImportOutcome, ImportTable,
};
use models_properties::service::property_value::PropertyValue;
use sha2::{Digest, Sha256};

/// Most columns one import creates.
const MAX_IMPORT_COLUMNS: usize = 100;
/// Most rows one import creates.
const MAX_IMPORT_ROWS: usize = 10_000;
/// Largest an import may be, encoded.
const MAX_IMPORT_BYTES: usize = 16 * 1024 * 1024;

fn validate_import(request: &mut ImportTable) -> Result<ImportFingerprint, DatabaseError> {
    request.name = validate_name(&request.name)?;
    if request.columns.is_empty()
        || request.columns.len() > MAX_IMPORT_COLUMNS
        || request.rows.len() > MAX_IMPORT_ROWS
    {
        return Err(DatabaseError::from(SchemaError::ImportTooWide));
    }
    let mut names = HashSet::new();
    for name in &mut request.columns {
        *name = validate_name(name)?;
        if !names.insert(name_key(name)) {
            return Err(DatabaseError::from(SchemaError::DuplicateImportColumn));
        }
    }
    if request
        .rows
        .iter()
        .any(|row| row.len() != request.columns.len())
    {
        return Err(DatabaseError::from(SchemaError::RaggedImportRow));
    }
    if request
        .rows
        .iter()
        .flatten()
        .any(|value| value.contains('\0'))
    {
        return Err(DatabaseError::from(SchemaError::NullCharacterInImport));
    }
    let encoded = serde_json::to_vec(request).map_err(repository_error)?;
    if encoded.len() > MAX_IMPORT_BYTES {
        return Err(DatabaseError::from(SchemaError::ImportTooLarge));
    }
    Ok(ImportFingerprint(format!("{:x}", Sha256::digest(encoded))))
}

impl<Repository, Definitions, Cells, Events, Access, Broker> DatabaseTransferService
    for DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore + DatabaseTransferRepo,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    #[tracing::instrument(skip(self, receipt, viewer, request), err)]
    async fn import_table(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        mut request: ImportTable,
    ) -> Result<Table, DatabaseError> {
        let fingerprint = validate_import(&mut request)?;
        let (database, tables) = self.database_for_edit(&receipt).await?;
        if let Some((table, previous)) = self
            .cells
            .imported_table(database.id, request.request_id)
            .await
            .map_err(repository_error)?
        {
            return if previous == fingerprint {
                Ok(table)
            } else {
                Err(DatabaseError::from(SchemaError::ImportRequestChanged))
            };
        }
        if tables
            .iter()
            .any(|table| same_name(&table.name, &request.name))
        {
            return Err(DatabaseError::from(SchemaError::ImportNameTaken));
        }
        let mut definitions = Vec::new();
        for name in &request.columns {
            match self
                .definitions
                .create_typed_definition(database.id, name, DataType::String, false, None, &[])
                .await
            {
                Ok(definition) => definitions.push(definition.definition.id),
                Err(error) => {
                    for id in &definitions {
                        self.delete_unused_definition(*id).await;
                    }
                    return Err(repository_error(error));
                }
            }
        }
        let cells: Vec<Vec<(PropertyDefinitionId, PropertyValue)>> = request
            .rows
            .iter()
            .map(|values| {
                definitions
                    .iter()
                    .zip(values)
                    .filter(|(_, value)| !value.is_empty())
                    .map(|(definition, value)| (*definition, PropertyValue::Str(value.clone())))
                    .collect()
            })
            .collect();
        let outcome = self
            .cells
            .import_table(
                database.id,
                &viewer,
                &request,
                &fingerprint,
                &definitions,
                &cells,
            )
            .await;
        // Only definite rejections/replays leave this attempt's definitions
        // unused. A failed acknowledgement may follow a successful commit.
        if matches!(
            &outcome,
            Ok(ImportOutcome::Replayed(_)
                | ImportOutcome::NameConflict
                | ImportOutcome::KeyConflict
                | ImportOutcome::NotFound)
        ) {
            for id in &definitions {
                self.delete_unused_definition(*id).await;
            }
        }
        match outcome.map_err(repository_error)? {
            ImportOutcome::Created(table) | ImportOutcome::Replayed(table) => {
                self.publish(
                    receipt_attribution(&receipt),
                    &[(database.id, table.id, table.version)],
                )
                .await;
                Ok(table)
            }
            ImportOutcome::NameConflict => Err(DatabaseError::from(SchemaError::ImportNameTaken)),
            ImportOutcome::KeyConflict => {
                Err(DatabaseError::from(SchemaError::ImportRequestChanged))
            }
            ImportOutcome::NotFound => Err(DatabaseError::NotFound),
        }
    }
}

#[cfg(test)]
mod test;
