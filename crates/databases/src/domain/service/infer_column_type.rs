use super::*;
use models_properties::shared::PropertyOwner;

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
    pub(super) async fn settle_column_type(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        cmd: InferColumnType,
    ) -> Result<InferColumnTypeOutcome, DatabaseError> {
        let (database, tables) = self.database_for_edit(&receipt).await?;
        let table = tables
            .iter()
            .find(|table| table.id == cmd.table_id)
            .ok_or(DatabaseError::NotFound)?;
        if table.version != cmd.base_version {
            return Err(DatabaseError::VersionConflict);
        }
        if !matches!(
            cmd.data_type,
            DataType::String | DataType::Number | DataType::Entity
        ) || (cmd.data_type == DataType::Entity) != cmd.specific_entity_type.is_some()
        {
            return Err(DatabaseError::InvalidSchemaOperation(
                "Choose text, number, or an entity with its specific type.".into(),
            ));
        }
        // Resolve the complete response before committing. A later refresh
        // failure must never turn a committed schema operation into a failure.
        let mut detail = self
            .column_detail(
                &viewer,
                database.id,
                AccessGrant::Edit,
                table.id,
                cmd.column_id,
            )
            .await?;
        let definition = &detail.definition.definition;
        if !detail.column.infer_type
            || detail.column.config.is_some()
            || definition.data_type != DataType::String
            || definition.is_multi_select
            || !matches!(definition.owner, PropertyOwner::Database { database_id } if database_id == database.id)
        {
            return Err(DatabaseError::InvalidSchemaOperation(
                "Only a new empty text column can infer its first value's type.".into(),
            ));
        }
        let replacement = if cmd.data_type == DataType::String {
            None
        } else {
            Some(
                self.definitions
                    .create_inferred_definition(
                        database.id,
                        &definition.display_name,
                        cmd.data_type,
                        cmd.specific_entity_type,
                    )
                    .await
                    .map_err(repo_err)?,
            )
        };
        let new_id = replacement
            .as_ref()
            .map_or(definition.id, |new| new.definition.id);
        let result = self
            .repo
            .infer_column_type(table, &detail.column, new_id)
            .await;
        let version = match result {
            Ok(Some(version)) => version,
            Ok(None) => {
                if replacement.is_some()
                    && let Err(error) = self.definitions.delete_unused_definition(new_id).await
                {
                    tracing::warn!(error = ?error, %new_id, "failed to clean up unused inferred definition");
                }
                if self
                    .repo
                    .table_versions(&[table.id])
                    .await
                    .ok()
                    .and_then(|versions| versions.get(&table.id).copied())
                    .is_some_and(|current| current != table.version)
                {
                    return Err(DatabaseError::VersionConflict);
                }
                return Err(DatabaseError::InvalidSchemaOperation(
                    "The column already contains values or the table changed. Refresh and try again.".into(),
                ));
            }
            // A transport failure can follow a committed transaction. Do not
            // delete the replacement when its commit outcome is uncertain.
            Err(error) => return Err(repo_err(error)),
        };
        detail.column.property_definition_id = new_id;
        detail.column.infer_type = false;
        if let Some(replacement) = replacement {
            detail.definition = replacement;
        }
        self.publish(
            receipt_attribution(&receipt),
            &HashMap::from([(table.id, database.id)]),
            &HashMap::from([(table.id, version)]),
        )
        .await;
        Ok(InferColumnTypeOutcome {
            column: detail,
            table_version: version,
        })
    }
}
