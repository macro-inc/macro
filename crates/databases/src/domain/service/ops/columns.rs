//! The column ops: adding, renaming, removing, ordering and retyping a
//! table's columns, and adding options, each checked against what earlier
//! ops leave.

use std::collections::{HashMap, HashSet};

use models_databases::cast::{Cast, Contents, cast};
use models_databases::position::{key_between, keys_between};
use models_databases::{ColumnKind, NewColumn, NewOption, TakenId};
use models_properties::api::is_valid_hex_color;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::service::property_value::PropertyValue;
use models_properties::shared::{DataType, PropertyOwner};

use super::super::column_types::{ConvertedCell, Converter, is_empty};
use super::super::views::{views_without_column, views_without_tests_of};
use super::super::{
    MAX_CONVERTED_ROWS, same_name, takes_options, validate_name, validate_option_labels,
};
use super::{ColumnCells, Place, Planner, refuse, refuse_taken, schema_refusal};
use crate::domain::catalog::{self, ColumnEntry, PropertyType, TableEntry};
use crate::domain::models::{
    Column, ColumnConfig, ColumnId, ColumnProtection, ColumnReplacement, DatabaseError, DatabaseId,
    DatabaseView, NewDefinition, OptionId, PropertyDefinitionId, RowId, SchemaError, TableId,
    Write, grant_writes,
};

impl Planner {
    pub(super) fn create_column(
        &mut self,
        place: Place,
        entry: &TableEntry,
        definition: &NewColumn,
        after: Option<ColumnId>,
    ) -> Result<Write, DatabaseError> {
        let id = place.column;
        if self.column_id_taken(id) {
            return Err(refuse_taken(place.op, TakenId::Column(id)));
        }
        let position = column_position(entry, place, after)?;
        let (definition, created, config, infer_type) = match definition {
            NewColumn::New {
                name,
                kind,
                options,
                infer_type,
            } => {
                let name = validate_name(name).map_err(|error| schema_refusal(place, error))?;
                if entry
                    .columns
                    .iter()
                    .any(|column| same_name(column.name(), &name))
                {
                    return Err(place.refuse(SchemaError::ColumnNameTaken { name }.to_string()));
                }
                let target = PropertyType::from_column_kind(*kind);
                let config = match kind {
                    ColumnKind::Relation { database, table } => {
                        self.link_target(place, *database, *table)?;
                        Some(ColumnConfig::Link {
                            database_id: *database,
                            table_id: *table,
                        })
                    }
                    _ => None,
                };
                if !options.is_empty() && !takes_options(target.data_type) {
                    return Err(place.refuse(SchemaError::OptionsOnPlainColumn.to_string()));
                }
                if *infer_type && (*kind != ColumnKind::Text || !options.is_empty()) {
                    return Err(place.refuse(SchemaError::InferenceNeedsPlainText.to_string()));
                }
                let options = self.new_options(place, target.data_type, options, &[], true)?;
                let created = NewDefinition {
                    id: macro_uuid::generate_uuid_v7(),
                    name,
                    data_type: target.data_type,
                    is_multi_select: target.is_multi_select,
                    specific_entity_type: target.specific_entity_type,
                    options,
                };
                (
                    stored_definition(self.database.id, &created),
                    Some(created),
                    config,
                    *infer_type,
                )
            }
            NewColumn::Existing { property } => {
                let definition = self
                    .found
                    .properties
                    .get(property)
                    .cloned()
                    .flatten()
                    .ok_or_else(|| {
                        place.refuse(
                            SchemaError::DefinitionNotFound(property.into_uuid()).to_string(),
                        )
                    })?;
                if entry.column_for(definition.definition.id).is_some() {
                    return Err(place.refuse(SchemaError::DefinitionAlreadyBound.to_string()));
                }
                let restored = self.restoration.columns.get(&id);
                let config = match restored.and_then(|column| column.kind) {
                    Some(ColumnKind::Relation { database, table }) => {
                        self.link_target(place, database, table)?;
                        Some(ColumnConfig::Link {
                            database_id: database,
                            table_id: table,
                        })
                    }
                    _ => None,
                };
                let infer_type = restored.is_some_and(|column| column.infer_type);
                (definition, None, config, infer_type)
            }
        };
        let column = Column {
            protections: vec![],
            id,
            table_id: entry.table.id,
            property_definition_id: definition.definition.id,
            position,
            config,
            display_name: None,
            infer_type,
        };
        let writable = grant_writes(self.grant);
        if let Some(entry) = self.entry_mut(entry.table.id) {
            entry.columns.push(ColumnEntry {
                column: column.clone(),
                definition,
                writable,
            });
            entry
                .columns
                .sort_by(|left, right| left.column.position.cmp(&right.column.position));
        }
        Ok(Write::CreateColumn {
            column,
            definition: created,
        })
    }

    pub(super) fn rename_column(
        &mut self,
        place: Place,
        entry: &TableEntry,
        column: &ColumnEntry,
        name: &str,
        previous_name: Option<&str>,
    ) -> Result<Write, DatabaseError> {
        let column_id = place.column;
        let current = column.name().to_owned();
        let name = validate_name(name).map_err(|error| schema_refusal(place, error))?;
        // A retry after a lost response is already complete.
        if current == name {
            return Ok(Write::Unchanged {
                table_id: entry.table.id,
            });
        }
        if previous_name.is_some_and(|previous| previous != current) {
            return Err(place.refuse(SchemaError::ColumnRenamedElsewhere.to_string()));
        }
        if entry
            .columns
            .iter()
            .any(|other| other.column.id != column_id && same_name(other.name(), &name))
        {
            return Err(place.refuse(SchemaError::ColumnLabelTaken.to_string()));
        }
        let from = column.column.display_name.clone();
        if let Some(column) = self.column_mut(entry.table.id, column_id) {
            column.column.display_name = Some(name.clone());
        }
        Ok(Write::RenameColumn {
            table_id: entry.table.id,
            column_id,
            from,
            name,
        })
    }

    pub(super) fn delete_column(
        &mut self,
        place: Place,
        entry: &TableEntry,
        column: &ColumnEntry,
    ) -> Result<Write, DatabaseError> {
        let column_id = place.column;
        if column
            .column
            .protections
            .contains(&ColumnProtection::Delete)
        {
            return Err(place.refuse(
                SchemaError::ColumnProtected {
                    capability: ColumnProtection::Delete,
                }
                .to_string(),
            ));
        }
        let now = self.now;
        let next_title = entry
            .columns
            .iter()
            .map(|other| other.column.id)
            .find(|other| *other != column_id);
        let views = views_without_column(self.views_of(entry), column_id, next_title, now)
            .map_err(|reason| place.refuse(reason.to_string()))?;
        self.store_views(entry.table.id, &views);
        let related = match column.column.config {
            Some(ColumnConfig::Link {
                database_id,
                table_id,
            }) if table_id != entry.table.id => Some((database_id, table_id)),
            _ => None,
        };
        let definition_id = column.definition.definition.id;
        if let Some(entry) = self.entry_mut(entry.table.id) {
            entry.columns.retain(|other| other.column.id != column_id);
        }
        self.found.cells.remove(&column_id);
        Ok(Write::DeleteColumn {
            table_id: entry.table.id,
            column_id,
            definition_id,
            views,
            related,
        })
    }

    pub(super) fn order_columns(
        &mut self,
        index: usize,
        entry: &TableEntry,
        order: &[ColumnId],
    ) -> Result<Write, DatabaseError> {
        let current: HashSet<ColumnId> = entry
            .columns
            .iter()
            .map(|column| column.column.id)
            .collect();
        let named: HashSet<ColumnId> = order.iter().copied().collect();
        if named.len() != order.len() || named != current {
            return Err(refuse(
                index,
                None,
                None,
                SchemaError::IncompleteColumnOrder.to_string(),
            ));
        }
        let keys = keys_between(None, None, order.len())
            .map_err(|error| refuse(index, None, None, error.to_string()))?;
        let positions: Vec<(ColumnId, _)> = order.iter().copied().zip(keys).collect();
        if let Some(entry) = self.entry_mut(entry.table.id) {
            for column in &mut entry.columns {
                if let Some((_, position)) =
                    positions.iter().find(|(id, _)| *id == column.column.id)
                {
                    column.column.position = position.clone();
                }
            }
            entry
                .columns
                .sort_by(|left, right| left.column.position.cmp(&right.column.position));
        }
        Ok(Write::OrderColumns {
            table_id: entry.table.id,
            positions,
        })
    }

    pub(super) fn add_options(
        &mut self,
        place: Place,
        entry: &TableEntry,
        column: &ColumnEntry,
        options: &[NewOption],
    ) -> Result<Write, DatabaseError> {
        self.option_column(place, column)?;
        let existing: Vec<String> = self
            .labels_of(&column.definition)
            .iter()
            .map(|(_, label)| label.clone())
            .collect();
        let data_type = column.definition.definition.data_type;
        let added = self.new_options(place, data_type, options, &existing, false)?;
        if added.is_empty() {
            return Ok(Write::Unchanged {
                table_id: entry.table.id,
            });
        }
        let definition_id = column.definition.definition.id;
        let labels = self.labels_of(&column.definition);
        labels.extend(
            added
                .iter()
                .map(|(id, value)| (*id, catalog::option_display(value))),
        );
        self.changed_options.insert(definition_id);
        Ok(Write::AddOptions {
            table_id: entry.table.id,
            tables: self.tables_binding(definition_id),
            definition_id,
            options: added,
        })
    }

    pub(super) fn change_type(
        &mut self,
        place: Place,
        entry: &TableEntry,
        column: &ColumnEntry,
        to: ColumnKind,
    ) -> Result<Write, DatabaseError> {
        let column_id = place.column;
        let source = column.definition.definition.id;
        if self.written_tables.contains(&entry.table.id) || self.changed_options.contains(&source) {
            return Err(place.refuse(SchemaError::RetypeAfterWrites.to_string()));
        }
        let relation = match to {
            ColumnKind::Relation { database, table } => {
                self.related_table(place, database, table)?;
                Some((database, table))
            }
            _ => None,
        };
        let now = self.now;
        let views = views_without_tests_of(self.views_of(entry), column_id, now)
            .map_err(|reason| place.refuse(reason.to_string()))?;
        if let Some(previous) = self.restoration.rebinds.get(&place.op).copied() {
            if column
                .column
                .protections
                .contains(&ColumnProtection::ChangeType)
            {
                return Err(place.refuse(
                    SchemaError::ColumnProtected {
                        capability: ColumnProtection::ChangeType,
                    }
                    .to_string(),
                ));
            }
            return self.rebind(place, entry, column, previous, relation, views);
        }
        let current = PropertyType::of(&column.column, &column.definition);
        let target = PropertyType::from_column_kind(to);
        let same_relation = match (&column.column.config, relation) {
            (Some(ColumnConfig::Link { table_id, .. }), Some((_, target_table))) => {
                *table_id == target_table
            }
            (_, None) => true,
            _ => false,
        };
        if current == target && same_relation {
            return Ok(Write::Unchanged {
                table_id: entry.table.id,
            });
        }

        if column
            .column
            .protections
            .contains(&ColumnProtection::ChangeType)
        {
            return Err(place.refuse(
                SchemaError::ColumnProtected {
                    capability: ColumnProtection::ChangeType,
                }
                .to_string(),
            ));
        }

        let stored = self
            .found
            .cells
            .get(&column_id)
            .cloned()
            .unwrap_or_default();
        if stored.rows.len() > MAX_CONVERTED_ROWS {
            return Err(place.refuse(SchemaError::TooManyRowsToRetype.to_string()));
        }
        let values: Vec<(RowId, &PropertyValue)> = stored
            .rows
            .iter()
            .filter_map(|row| {
                stored
                    .cells
                    .get(row)
                    .filter(|value| !is_empty(value))
                    .map(|value| (*row, value))
            })
            .collect();
        let contents = if values.is_empty() {
            Contents::Empty
        } else {
            Contents::Filled
        };
        if let Cast::Never(reason) = cast(current.cast_kind(), target.cast_kind(), contents) {
            return Err(place.refuse(reason));
        }
        let mut converter = Converter::new(&column.definition, target);
        for (row, value) in &values {
            converter.push(*row, value);
        }
        if let Some(refusal) = converter.refusal(column.name()) {
            return Err(place.refuse(SchemaError::Misfits(refusal).to_string()));
        }

        let options: Vec<(OptionId, PropertyOptionValue)> =
            validate_option_labels(target.data_type, &converter.labels, &[])
                .map_err(|error| schema_refusal(place, error))?
                .into_iter()
                .map(|value| (OptionId::new(), value))
                .collect();
        let option_ids: HashMap<String, OptionId> = options
            .iter()
            .map(|(id, value)| (catalog::option_display(value), *id))
            .collect();
        let definition = NewDefinition {
            id: macro_uuid::generate_uuid_v7(),
            name: column.definition.definition.display_name.clone(),
            data_type: target.data_type,
            is_multi_select: target.is_multi_select,
            specific_entity_type: target.specific_entity_type,
            options,
        };
        let converted: Vec<(RowId, PropertyValue)> = converter
            .cells
            .into_iter()
            .map(|(row, value)| {
                let value = match value {
                    ConvertedCell::Value(value) => value,
                    ConvertedCell::Options(labels) => PropertyValue::SelectOption(
                        labels
                            .iter()
                            .filter_map(|label| option_ids.get(label))
                            .map(|id| id.into_uuid())
                            .collect(),
                    ),
                };
                (row, value)
            })
            .collect();
        let config = relation.map(|(database_id, table_id)| ColumnConfig::Link {
            database_id,
            table_id,
        });
        let replacement = ColumnReplacement {
            column: column.column.clone(),
            definition_id: definition.id,
            config: config.clone(),
            values: converted.clone(),
        };
        // A table this batch created has no stored version to hold on to.
        let read_version =
            (!self.created_tables.contains(&entry.table.id)).then_some(entry.table.version);

        self.store_views(entry.table.id, &views);
        let stored_definition = stored_definition(self.database.id, &definition);
        if let Some(column) = self.column_mut(entry.table.id, column_id) {
            column.column.property_definition_id = definition.id;
            column.column.config = config;
            column.column.infer_type = false;
            column.definition = stored_definition;
        }
        self.found.cells.insert(
            column_id,
            ColumnCells {
                rows: stored.rows,
                cells: converted.into_iter().collect(),
            },
        );
        Ok(Write::ReplaceColumn {
            table_id: entry.table.id,
            read_version,
            definition: Some(definition),
            replacement,
            views,
        })
    }

    /// Bind a column back to a definition it had before a type change: the
    /// definition still exists, with its options, so the cells written back
    /// after this op name them as they were.
    fn rebind(
        &mut self,
        place: Place,
        entry: &TableEntry,
        column: &ColumnEntry,
        previous: PropertyDefinitionId,
        relation: Option<(DatabaseId, TableId)>,
        views: Vec<DatabaseView>,
    ) -> Result<Write, DatabaseError> {
        let definition = self
            .found
            .rebound
            .get(&previous)
            .cloned()
            .ok_or_else(|| place.refuse("the column's earlier definition is gone"))?;
        let config = relation.map(|(database_id, table_id)| ColumnConfig::Link {
            database_id,
            table_id,
        });
        let replacement = ColumnReplacement {
            column: column.column.clone(),
            definition_id: previous,
            config: config.clone(),
            values: Vec::new(),
        };
        self.store_views(entry.table.id, &views);
        if let Some(stored) = self.column_mut(entry.table.id, place.column) {
            stored.column.property_definition_id = previous;
            stored.column.config = config;
            stored.column.infer_type = false;
            stored.definition = definition;
        }
        self.found.cells.remove(&place.column);
        Ok(Write::ReplaceColumn {
            table_id: entry.table.id,
            read_version: Some(entry.table.version),
            definition: None,
            replacement,
            views,
        })
    }

    pub(super) fn update_option(
        &mut self,
        place: Place,
        entry: &TableEntry,
        column: &ColumnEntry,
        option: OptionId,
        label: Option<&str>,
        color: Option<&Option<String>>,
    ) -> Result<Write, DatabaseError> {
        self.option_column(place, column)?;
        self.known_option(place, column, option)?;
        let value = label
            .map(|label| self.relabel(place, column, option, label))
            .transpose()?;
        let color = match color {
            Some(None) if column.definition.definition.data_type == DataType::Tag => {
                return Err(place.refuse("a tag option always has a colour; pick another instead"));
            }
            Some(Some(color)) if !is_valid_hex_color(color) => {
                return Err(place.refuse(format!(
                    "{color} is not a colour; give a hex string like #RRGGBB"
                )));
            }
            Some(color) => Some(color.clone()),
            None => None,
        };
        let definition_id = column.definition.definition.id;
        self.changed_options.insert(definition_id);
        Ok(Write::UpdateOption {
            table_id: entry.table.id,
            tables: self.tables_binding(definition_id),
            definition_id,
            option_id: option,
            value,
            color,
        })
    }

    pub(super) fn delete_option(
        &mut self,
        place: Place,
        entry: &TableEntry,
        column: &ColumnEntry,
        option: OptionId,
    ) -> Result<Write, DatabaseError> {
        self.option_column(place, column)?;
        self.known_option(place, column, option)?;
        self.labels_of(&column.definition)
            .retain(|(id, _)| *id != option);
        let definition_id = column.definition.definition.id;
        self.changed_options.insert(definition_id);
        let tables = self.tables_binding(definition_id);
        let views = self.views_without_option(&tables, definition_id, option);
        Ok(Write::DeleteOption {
            only_if_unused: self.restoration.unused_options.contains(&option),
            table_id: entry.table.id,
            tables,
            definition_id,
            option_id: option,
            views,
        })
    }

    /// Options to create, checked as labels of a column of `data_type`
    /// holding `existing`: each label valid and, under its id, new. A label
    /// already among `existing` or listed earlier is refused when `strict`,
    /// and otherwise left out.
    fn new_options(
        &self,
        place: Place,
        data_type: DataType,
        options: &[NewOption],
        existing: &[String],
        strict: bool,
    ) -> Result<Vec<(OptionId, PropertyOptionValue)>, DatabaseError> {
        let mut taken: Vec<String> = existing.to_vec();
        let mut accepted: Vec<(OptionId, PropertyOptionValue)> = Vec::new();
        for option in options {
            let value =
                validate_option_labels(data_type, std::slice::from_ref(&option.label), &taken)
                    .map_err(|error| schema_refusal(place, error))?
                    .into_iter()
                    .next();
            let Some(value) = value else {
                if strict {
                    return Err(place.refuse(
                        SchemaError::OptionListedTwice {
                            label: option.label.trim().to_owned(),
                        }
                        .to_string(),
                    ));
                }
                continue;
            };
            if self.option_id_taken(option.id) || accepted.iter().any(|(id, _)| *id == option.id) {
                return Err(refuse_taken(place.op, TakenId::Option(option.id)));
            }
            taken.push(catalog::option_display(&value));
            accepted.push((option.id, value));
        }
        Ok(accepted)
    }

    /// Whether a column of the database, as the ops so far leave it, has
    /// the id.
    fn column_id_taken(&self, id: ColumnId) -> bool {
        self.entries
            .iter()
            .any(|entry| entry.columns.iter().any(|column| column.column.id == id))
    }

    /// Whether an option of the database's columns, as the ops so far leave
    /// them, has the id.
    fn option_id_taken(&self, id: OptionId) -> bool {
        self.labels
            .values()
            .any(|labels| labels.iter().any(|(option, _)| *option == id))
            || self.entries.iter().any(|entry| {
                entry.columns.iter().any(|column| {
                    column
                        .definition
                        .property_options
                        .iter()
                        .any(|option| option.id == id.into_uuid())
                })
            })
    }

    /// Check a new relation's target is a table the viewer can reach: in
    /// this database as the ops so far leave it, or in another they can see.
    fn link_target(
        &self,
        place: Place,
        database: DatabaseId,
        table: TableId,
    ) -> Result<(), DatabaseError> {
        if database == self.database.id {
            return if self.entries.iter().any(|entry| entry.table.id == table) {
                Ok(())
            } else {
                Err(place.refuse(SchemaError::LinkTableMissing.to_string()))
            };
        }
        match self.found.relation_targets.get(&database) {
            Some(Some(tables)) if tables.contains(&table) => Ok(()),
            Some(Some(_)) => Err(place.refuse(SchemaError::LinkTableMissing.to_string())),
            _ => Err(place.refuse(SchemaError::LinkDatabaseInaccessible.to_string())),
        }
    }

    /// Check a type change's relation target, refused as the type change
    /// refuses it.
    fn related_table(
        &self,
        place: Place,
        database: DatabaseId,
        table: TableId,
    ) -> Result<(), DatabaseError> {
        self.link_target(place, database, table)
            .map_err(|_| place.refuse(SchemaError::RelatedTableInaccessible.to_string()))
    }

    /// One column of a table, to change it in place.
    fn column_mut(&mut self, table: TableId, column: ColumnId) -> Option<&mut ColumnEntry> {
        self.entry_mut(table)?
            .columns
            .iter_mut()
            .find(|entry| entry.column.id == column)
    }

    /// Keep views a schema op rewrote as the table's current ones.
    fn store_views(&mut self, table: TableId, rewritten: &[DatabaseView]) {
        let Some(views) = self.views.get_mut(&table) else {
            return;
        };
        for view in rewritten {
            if let Some(current) = views.iter_mut().find(|current| current.id == view.id) {
                *current = view.clone();
            }
        }
    }
}

/// Where a new column goes: right after `after`, or after the table's last.
fn column_position(
    entry: &TableEntry,
    place: Place,
    after: Option<ColumnId>,
) -> Result<models_databases::position::Position, DatabaseError> {
    let positions: Vec<&models_databases::position::Position> = entry
        .columns
        .iter()
        .map(|column| &column.column.position)
        .collect();
    let (before, next) = match after {
        Some(after) => {
            let at = entry
                .columns
                .iter()
                .position(|column| column.column.id == after)
                .ok_or_else(|| {
                    super::refuse(
                        place.op,
                        None,
                        Some(after),
                        "the column to place it after is not in this table",
                    )
                })?;
            (Some(positions[at]), positions.get(at + 1).copied())
        }
        None => (positions.last().copied(), None),
    };
    key_between(before, next).map_err(|error| place.refuse(error.to_string()))
}

/// The definition a write creates, as the catalog holds it once stored.
fn stored_definition(
    database: DatabaseId,
    definition: &NewDefinition,
) -> PropertyDefinitionWithOptions {
    let now = chrono::Utc::now();
    PropertyDefinitionWithOptions {
        definition: PropertyDefinition {
            id: definition.id,
            owner: PropertyOwner::Database {
                database_id: database.into_uuid(),
            },
            display_name: definition.name.clone(),
            data_type: definition.data_type,
            is_multi_select: definition.is_multi_select,
            specific_entity_type: definition.specific_entity_type,
            created_at: now,
            updated_at: now,
            is_system: false,
            is_metadata: false,
        },
        property_options: definition
            .options
            .iter()
            .enumerate()
            .map(|(order, (id, value))| PropertyOption {
                id: id.into_uuid(),
                property_definition_id: definition.id,
                display_order: i32::try_from(order).unwrap_or(i32::MAX),
                value: value.clone(),
                color: None,
                created_at: now,
                updated_at: now,
            })
            .collect(),
    }
}
