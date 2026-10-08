use super::*;
use models_properties::shared::PropertyOwner;

impl<Repository, Definitions, Cells, Events, Access, Broker>
    DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    pub(super) async fn settle_column_type(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        command: InferColumnType,
    ) -> Result<InferColumnTypeOutcome, DatabaseError> {
        let (database, tables) = self.database_for_edit(&receipt).await?;
        let table = tables
            .iter()
            .find(|table| table.id == command.table_id)
            .ok_or(DatabaseError::NotFound)?;
        if table.version != command.base_version {
            return Err(DatabaseError::VersionConflict);
        }
        if !matches!(
            command.data_type,
            DataType::String | DataType::Number | DataType::Entity
        ) || (command.data_type == DataType::Entity) != command.specific_entity_type.is_some()
        {
            return Err(DatabaseError::from(SchemaError::UnsupportedInferredType));
        }
        // Resolve the complete response before committing. A later refresh
        // failure must never turn a committed schema operation into a failure.
        let mut detail = self
            .column_detail(database.id, AccessLevel::Edit, table.id, command.column_id)
            .await?;
        let definition = &detail.definition.definition;
        if !detail.column.infer_type
            || detail.column.config.is_some()
            || definition.data_type != DataType::String
            || definition.is_multi_select
            || !matches!(definition.owner, PropertyOwner::Database { database_id } if DatabaseId::from_uuid(database_id) == database.id)
        {
            return Err(DatabaseError::from(SchemaError::InferenceNeedsEmptyText));
        }
        let replacement = if command.data_type == DataType::String {
            None
        } else {
            Some(
                self.definitions
                    .create_typed_definition(
                        database.id,
                        &definition.display_name,
                        command.data_type,
                        false,
                        command.specific_entity_type,
                        &[],
                    )
                    .await
                    .map_err(repository_error)?,
            )
        };
        let new_id = replacement
            .as_ref()
            .map_or(definition.id, |new| new.definition.id);
        let result = self
            .repository
            .infer_column_type(
                table,
                &detail.column,
                new_id,
                &receipt_journal_actor(&receipt),
            )
            .await;
        let version = match result {
            Ok(Some(version)) => version,
            Ok(None) => {
                if replacement.is_some() {
                    self.delete_unused_definition(new_id).await;
                }
                if self
                    .repository
                    .table_versions(&[table.id])
                    .await
                    .map_err(repository_error)?
                    .get(&table.id)
                    .is_some_and(|current| *current != table.version)
                {
                    return Err(DatabaseError::VersionConflict);
                }
                return Err(DatabaseError::from(SchemaError::InferenceRaced));
            }
            // A transport failure can follow a committed transaction. Do not
            // delete the replacement when its commit outcome is uncertain.
            Err(error) => return Err(repository_error(error)),
        };
        detail.column.property_definition_id = new_id;
        detail.column.infer_type = false;
        if let Some(replacement) = replacement {
            detail.definition = replacement;
        }
        self.publish(
            receipt_attribution(&receipt),
            &[(database.id, table.id, version)],
        )
        .await;
        Ok(InferColumnTypeOutcome {
            column: detail,
            table_version: version,
        })
    }
}
