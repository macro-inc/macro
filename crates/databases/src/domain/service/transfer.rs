use super::*;
use crate::domain::transfer::{
    DatabaseTransferRepo, DatabaseTransferService, ImportOutcome, ImportTable,
};
use sha2::{Digest, Sha256};

fn validate_import(request: &mut ImportTable) -> Result<String, DatabaseError> {
    request.name = validate_name(&request.name)?;
    if request.columns.is_empty() || request.columns.len() > 100 || request.rows.len() > 10_000 {
        return Err(DatabaseError::InvalidSchemaOperation(
            "Import up to 100 columns and 10,000 rows.".into(),
        ));
    }
    let mut names = HashSet::new();
    for name in &mut request.columns {
        *name = validate_name(name)?;
        if !names.insert(name.to_lowercase()) {
            return Err(DatabaseError::InvalidSchemaOperation(
                "Each column needs a distinct name.".into(),
            ));
        }
    }
    if request
        .rows
        .iter()
        .any(|row| row.len() != request.columns.len())
    {
        return Err(DatabaseError::InvalidSchemaOperation(
            "Each row must match the CSV header.".into(),
        ));
    }
    if request
        .rows
        .iter()
        .flatten()
        .any(|value| value.contains('\0'))
    {
        return Err(DatabaseError::InvalidSchemaOperation(
            "The CSV contains null characters. Remove them before importing.".into(),
        ));
    }
    let encoded = serde_json::to_vec(request).map_err(repo_err)?;
    if encoded.len() > 16 * 1024 * 1024 {
        return Err(DatabaseError::InvalidSchemaOperation(
            "The import is too large.".into(),
        ));
    }
    Ok(format!("{:x}", Sha256::digest(encoded)))
}

impl<Repo, Defs, Magic, Exec, Events, Access, Broker> DatabaseTransferService
    for DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events, Access, Broker>
where
    Repo: DatabasesRepo + DatabaseTransferRepo,
    Defs: ColumnDefinitionStore,
    Magic: MagicTables,
    Exec: SqlExecutor,
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
            .repo
            .imported_table(database.id, request.request_id)
            .await
            .map_err(repo_err)?
        {
            return if previous == fingerprint {
                Ok(table)
            } else {
                Err(DatabaseError::InvalidSchemaOperation(
                    "This import request changed. Start a new import.".into(),
                ))
            };
        }
        if tables
            .iter()
            .any(|table| same_name(&table.name, &request.name))
        {
            return Err(DatabaseError::InvalidSchemaOperation(
                "A table with this name already exists. Choose another name.".into(),
            ));
        }
        let mut definitions = Vec::new();
        for name in &request.columns {
            match self
                .definitions
                .create_typed_definition(database.id, name, DataType::String, false, None)
                .await
            {
                Ok(definition) => definitions.push(definition.definition.id),
                Err(error) => {
                    for id in definitions {
                        let _ = self.definitions.delete_unused_definition(id).await;
                    }
                    return Err(repo_err(error));
                }
            }
        }
        let outcome = self
            .repo
            .import_table(database.id, &viewer, &request, &fingerprint, &definitions)
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
            for id in definitions {
                if let Err(error) = self.definitions.delete_unused_definition(id).await {
                    tracing::warn!(?error, %id, "could not clean up unused import definition");
                }
            }
        }
        match outcome.map_err(repo_err)? {
            ImportOutcome::Created(table) | ImportOutcome::Replayed(table) => {
                self.publish(
                    receipt_attribution(&receipt),
                    &HashMap::from([(table.id, database.id)]),
                    &HashMap::from([(table.id, table.version)]),
                )
                .await;
                Ok(table)
            }
            ImportOutcome::NameConflict => Err(DatabaseError::InvalidSchemaOperation(
                "A table with this name already exists. Choose another name.".into(),
            )),
            ImportOutcome::KeyConflict => Err(DatabaseError::InvalidSchemaOperation(
                "This import request changed. Start a new import.".into(),
            )),
            ImportOutcome::NotFound => Err(DatabaseError::NotFound),
        }
    }
}

#[cfg(test)]
mod test;
