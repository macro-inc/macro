use super::column_types::{ConvertedCell, convert_cell};
use super::*;
use models_properties::service::property_value::PropertyValue;

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
    pub(super) async fn change_placement_type(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        cmd: ChangeColumnType,
    ) -> Result<ColumnSchemaOutcome, DatabaseError> {
        let (database, tables) = self.database_for_edit(&receipt).await?;
        let table = tables
            .iter()
            .find(|table| table.id == cmd.table_id)
            .ok_or(DatabaseError::NotFound)?;
        if table.version != cmd.base_version {
            return Err(DatabaseError::VersionConflict);
        }
        if (cmd.specific_entity_type.is_some()
            && (cmd.data_type != DataType::Entity || cmd.relation.is_some()))
            || (cmd.data_type == DataType::Entity
                && cmd.relation.is_none()
                && cmd.specific_entity_type.is_none())
            || (cmd.relation.is_some()
                && (cmd.data_type != DataType::Entity || !cmd.is_multi_select))
            || (cmd.is_multi_select
                && !matches!(
                    cmd.data_type,
                    DataType::SelectString
                        | DataType::SelectNumber
                        | DataType::Tag
                        | DataType::Entity
                        | DataType::Link
                ))
            || (cmd.data_type == DataType::Tag && !cmd.is_multi_select)
        {
            return Err(DatabaseError::InvalidSchemaOperation(
                "Choose a supported column type and its reference target.".into(),
            ));
        }
        if let Some((database_id, table_id)) = cmd.relation {
            let grants = self
                .access
                .accessible_databases(&viewer)
                .await
                .map_err(repo_err)?;
            if !grants.iter().any(|(id, _)| *id == database_id)
                || !self
                    .repo
                    .tables_for_databases(&[database_id])
                    .await
                    .map_err(repo_err)?
                    .iter()
                    .any(|table| table.id == table_id)
            {
                return Err(DatabaseError::InvalidSchemaOperation(
                    "The related table is not accessible.".into(),
                ));
            }
        }
        let detail = self
            .column_detail(
                &viewer,
                database.id,
                AccessGrant::Edit,
                table.id,
                cmd.column_id,
            )
            .await?;
        if self.repo.columns_for_tables(&[table.id]).await.map_err(repo_err)?.iter()
            .any(|column| matches!(column.config, Some(ColumnConfig::Lookup { via_column_id, .. }) if via_column_id == cmd.column_id)) {
            return Err(DatabaseError::InvalidSchemaOperation("Remove the lookup that uses this column before changing its type.".into()));
        }
        if matches!(detail.column.config, Some(ColumnConfig::Lookup { .. })) {
            return Err(DatabaseError::InvalidSchemaOperation(
                "A lookup's type comes from its source column.".into(),
            ));
        }
        if matches!(detail.column.config, Some(ColumnConfig::Link { .. }))
            && !self
                .repo
                .fetch_links(cmd.column_id, 1)
                .await
                .map_err(repo_err)?
                .is_empty()
        {
            return Err(DatabaseError::InvalidSchemaOperation(
                "Remove the existing relationships before changing this column's type or target."
                    .into(),
            ));
        }
        let rows = self
            .repo
            .fetch_rows(table.id, MAX_MATERIALIZED_ROWS + 1)
            .await
            .map_err(repo_err)?;
        if rows.len() > MAX_MATERIALIZED_ROWS {
            return Err(DatabaseError::InvalidSchemaOperation(
                "This table is too large to validate a type change in one operation.".into(),
            ));
        }
        let mut converted = Vec::new();
        let mut labels = Vec::new();
        // Preserve unused select options too; changing multiplicity must not
        // silently discard the schema's existing choices.
        if takes_options(cmd.data_type) {
            for option in &detail.definition.property_options {
                let value = match &option.value {
                    PropertyOptionValue::String(value) => PropertyValue::Str(value.clone()),
                    PropertyOptionValue::Number(value) => PropertyValue::Num(*value),
                };
                if let Some(ConvertedCell::Options(options)) =
                    convert_cell(&value, &detail.definition, &cmd)?
                {
                    labels.extend(options);
                }
            }
        }
        if detail.column.config.is_none() {
            for row in rows {
                if let Some(value) = row.cells.get(&detail.column.property_definition_id)
                    && let Some(value) = convert_cell(value, &detail.definition, &cmd)?
                {
                    if let ConvertedCell::Options(options) = &value {
                        labels.extend(options.iter().cloned());
                    }
                    converted.push((row.id, value));
                }
            }
        }
        let mut seen = HashSet::new();
        labels.retain(|label| seen.insert(label.clone()));
        let distinct: HashSet<_> = labels.iter().map(|label| option_key(label)).collect();
        if distinct.len() != labels.len() {
            return Err(DatabaseError::InvalidSchemaOperation("Some values differ only by capitalization. Keep Text or make their spelling consistent before converting to choices.".into()));
        }
        let options = validate_option_labels(cmd.data_type, &labels, &[])?;
        let mut definition = self
            .definitions
            .create_typed_definition(
                database.id,
                &detail.definition.definition.display_name,
                cmd.data_type,
                cmd.is_multi_select,
                cmd.specific_entity_type,
            )
            .await
            .map_err(repo_err)?;
        let new_id = definition.definition.id;
        if !options.is_empty() {
            match self.definitions.add_options(new_id, &options).await {
                Ok(options) => definition.property_options = options,
                Err(error) => {
                    let _ = self.definitions.delete_unused_definition(new_id).await;
                    return Err(repo_err(error));
                }
            }
        }
        let option_ids: HashMap<_, _> = catalog::option_labels(&definition)
            .into_iter()
            .map(|(id, label)| (label, id))
            .collect();
        let values = converted
            .into_iter()
            .map(|(id, value)| {
                (
                    id,
                    match value {
                        ConvertedCell::Value(value) => value,
                        ConvertedCell::Options(labels) => PropertyValue::SelectOption(
                            labels.iter().map(|label| option_ids[label]).collect(),
                        ),
                    },
                )
            })
            .collect();
        let replacement = ColumnReplacement {
            column: detail.column,
            definition_id: new_id,
            config: cmd
                .relation
                .map(|(database_id, table_id)| ColumnConfig::Link {
                    database_id,
                    table_id,
                }),
            values,
        };
        let version = match self.repo.replace_column(table, &replacement).await {
            Ok(Some(version)) => version,
            Ok(None) => {
                if let Err(error) = self.definitions.delete_unused_definition(new_id).await {
                    tracing::warn!(error = ?error, %new_id, "failed to clean up unused column definition");
                }
                return Err(DatabaseError::VersionConflict);
            }
            // The commit could have succeeded before a transport error. Never
            // delete a potentially bound replacement on an uncertain outcome.
            Err(error) => return Err(repo_err(error)),
        };
        let table_versions = HashMap::from([(table.id, version)]);
        self.publish(
            receipt_attribution(&receipt),
            &HashMap::from([(table.id, database.id)]),
            &table_versions,
        )
        .await;
        Ok(ColumnSchemaOutcome { table_versions })
    }

    pub(super) async fn remove_placement(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        table_id: TableId,
        column_id: ColumnId,
        base_version: TableVersion,
    ) -> Result<ColumnSchemaOutcome, DatabaseError> {
        let (database, tables) = self.database_for_edit(&receipt).await?;
        let table = tables
            .iter()
            .find(|table| table.id == table_id)
            .ok_or(DatabaseError::NotFound)?;
        if table.version != base_version {
            return Err(DatabaseError::VersionConflict);
        }
        let columns = self
            .repo
            .columns_for_tables(&[table_id])
            .await
            .map_err(repo_err)?;
        let column = columns
            .iter()
            .find(|column| column.id == column_id)
            .ok_or(DatabaseError::NotFound)?;
        if columns.iter().any(|column| matches!(column.config, Some(ColumnConfig::Lookup { via_column_id, .. }) if via_column_id == column_id)) {
            return Err(DatabaseError::InvalidSchemaOperation("Remove the lookup that uses this column first.".into()));
        }
        let outcome = self
            .repo
            .delete_column(table, column)
            .await
            .map_err(repo_err)?
            .ok_or(DatabaseError::VersionConflict)?;
        let mut databases = HashMap::from([(table_id, database.id)]);
        if let Some(ColumnConfig::Link {
            database_id,
            table_id,
        }) = column.config
        {
            databases.insert(table_id, database_id);
        }
        self.publish(
            receipt_attribution(&receipt),
            &databases,
            &outcome.table_versions,
        )
        .await;
        Ok(outcome)
    }

    pub(super) async fn order_placements(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        table_id: TableId,
        ids: Vec<ColumnId>,
        base_version: TableVersion,
    ) -> Result<ColumnSchemaOutcome, DatabaseError> {
        let (database, tables) = self.database_for_edit(&receipt).await?;
        let table = tables
            .iter()
            .find(|table| table.id == table_id)
            .ok_or(DatabaseError::NotFound)?;
        if table.version != base_version {
            return Err(DatabaseError::VersionConflict);
        }
        let columns = self
            .repo
            .columns_for_tables(&[table_id])
            .await
            .map_err(repo_err)?;
        let expected: HashSet<_> = columns.iter().map(|column| column.id).collect();
        if ids.len() != expected.len() || ids.iter().copied().collect::<HashSet<_>>() != expected {
            return Err(DatabaseError::InvalidSchemaOperation(
                "The column order must include every column exactly once.".into(),
            ));
        }
        let version = self
            .repo
            .reorder_columns(table, &ids)
            .await
            .map_err(repo_err)?
            .ok_or(DatabaseError::VersionConflict)?;
        let table_versions = HashMap::from([(table_id, version)]);
        self.publish(
            receipt_attribution(&receipt),
            &HashMap::from([(table_id, database.id)]),
            &table_versions,
        )
        .await;
        Ok(ColumnSchemaOutcome { table_versions })
    }
}
