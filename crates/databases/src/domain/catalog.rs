//! The viewer's catalog: every table they can see, with its columns bound to
//! their definitions.

use std::collections::HashMap;

use models_databases::cast::{Cast, CastKind, Contents, TARGETS, cast};
use models_databases::property::{DataType as StoredDataType, OptionValue, stored_cast_kind};
use models_databases::views::{SchemaColumn, ValueKind};
use models_databases::{ColumnKind, EntityKind, OptionId};
use models_permissions::share_permission::access_level::AccessLevel;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::shared::{DataType, PropertyOwner};

use crate::domain::models::{
    Column, Database, DatabaseId, DatabaseView, PropertyDefinitionId, Table, TableId, grant_writes,
};

/// One table the viewer can see, with what the service needs to write and
/// describe it.
#[derive(Debug, Clone)]
pub struct TableEntry {
    /// The database the table belongs to.
    pub database: Database,
    /// The table.
    pub table: Table,
    /// The viewer's grant on the database.
    pub grant: AccessLevel,
    /// The columns, in display order.
    pub columns: Vec<ColumnEntry>,
    /// The table's views, in their order.
    pub views: Vec<DatabaseView>,
}

/// One column placement with the definition behind it.
#[derive(Debug, Clone)]
pub struct ColumnEntry {
    /// The placement.
    pub column: Column,
    /// The definition behind it.
    pub definition: PropertyDefinitionWithOptions,
    /// Whether the viewer may write this column.
    pub writable: bool,
}

impl ColumnEntry {
    /// The name the column goes by: the placement's own, else the
    /// definition's.
    pub fn name(&self) -> &str {
        self.column.name(&self.definition)
    }

    /// Whether the column is a relation to rows of another table.
    pub fn is_relation(&self) -> bool {
        self.column.is_relation()
    }

    /// Whether a cell holds several values.
    pub fn is_multi(&self) -> bool {
        self.definition.definition.is_multi_select || self.is_relation()
    }

    /// Whether the column's cells are drawn from its options.
    pub fn takes_options(&self) -> bool {
        takes_options(self.definition.definition.data_type)
    }

    /// The kind of value the column holds, as a view's filters test it.
    pub fn value_kind(&self) -> ValueKind {
        PropertyType::of(&self.column, &self.definition)
            .cast_kind()
            .value_kind()
    }

    /// Whether the definition belongs to something beyond `database_id`, so
    /// a change to it shows wherever else it is used.
    pub fn shared_outside(&self, database_id: DatabaseId) -> bool {
        !matches!(
            self.definition.definition.owner,
            PropertyOwner::Database { database_id: owner } if DatabaseId::from_uuid(owner) == database_id
        )
    }
}

impl TableEntry {
    /// The column bound to a definition.
    pub fn column_for(&self, definition: PropertyDefinitionId) -> Option<&ColumnEntry> {
        self.columns
            .iter()
            .find(|column| column.definition.definition.id == definition)
    }
}

/// Whether a data type's cells are drawn from an explicit set of options.
pub fn takes_options(data_type: DataType) -> bool {
    stored_data_type(data_type).takes_options()
}

/// A property type in the terms the cast rule and the engine's schema take.
pub fn stored_data_type(data_type: DataType) -> StoredDataType {
    match data_type {
        DataType::String => StoredDataType::String,
        DataType::Number => StoredDataType::Number,
        DataType::Boolean => StoredDataType::Boolean,
        DataType::Date => StoredDataType::Date,
        DataType::Link => StoredDataType::Link,
        DataType::SelectString => StoredDataType::SelectString,
        DataType::SelectNumber => StoredDataType::SelectNumber,
        DataType::Tag => StoredDataType::Tag,
        DataType::Entity => StoredDataType::Entity,
    }
}

/// A table's columns as a view's checks see them.
pub fn schema_columns(entry: &TableEntry) -> Vec<SchemaColumn> {
    entry
        .columns
        .iter()
        .map(|column| {
            SchemaColumn::new(
                column.column.id,
                column.name().to_string(),
                PropertyType::of(&column.column, &column.definition).cast_kind(),
                column.is_multi(),
                option_labels(&column.definition)
                    .into_iter()
                    .map(|(id, _)| id)
                    .collect(),
            )
        })
        .collect()
}

/// Assemble the viewer's entries from what the repository returned.
pub fn build_entries(
    databases: &[Database],
    tables: &[Table],
    columns: &[Column],
    definitions: &HashMap<PropertyDefinitionId, PropertyDefinitionWithOptions>,
    views: &[DatabaseView],
    grants: &HashMap<DatabaseId, AccessLevel>,
) -> Vec<TableEntry> {
    let databases_by_id: HashMap<DatabaseId, &Database> = databases
        .iter()
        .map(|database| (database.id, database))
        .collect();
    let mut columns_by_table: HashMap<TableId, Vec<&Column>> = HashMap::new();
    for column in columns {
        columns_by_table
            .entry(column.table_id)
            .or_default()
            .push(column);
    }
    tables
        .iter()
        .filter_map(|table| {
            let grant = *grants.get(&table.database_id)?;
            let database = *databases_by_id.get(&table.database_id)?;
            let writable = grant_writes(grant);
            let columns = columns_by_table
                .get(&table.id)
                .into_iter()
                .flatten()
                .filter_map(|column| {
                    let definition = definitions.get(&column.property_definition_id)?.clone();
                    Some(ColumnEntry {
                        column: (*column).clone(),
                        definition,
                        writable,
                    })
                })
                .collect();
            let mut table_views: Vec<DatabaseView> = views
                .iter()
                .filter(|view| view.table_id == table.id)
                .cloned()
                .collect();
            table_views.sort_by(|left, right| left.position.cmp(&right.position));
            Some(TableEntry {
                database: database.clone(),
                table: table.clone(),
                grant,
                columns,
                views: table_views,
            })
        })
        .collect()
}

/// A column's type as the properties system stores it: what a column is,
/// or what a type change asks it to become.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PropertyType {
    /// The property type.
    pub data_type: DataType,
    /// Whether a cell holds several values.
    pub is_multi_select: bool,
    /// What a reference column points at; `None` for a relation.
    pub specific_entity_type: Option<models_properties::EntityType>,
    /// Whether the column relates rows of another table.
    pub relation: bool,
}

impl PropertyType {
    /// A relation to some table's rows.
    pub const RELATION: PropertyType = PropertyType {
        data_type: DataType::Entity,
        is_multi_select: true,
        specific_entity_type: None,
        relation: true,
    };

    /// The type of a column placement bound to `definition`.
    pub fn of(column: &Column, definition: &PropertyDefinitionWithOptions) -> Self {
        let relation = column.is_relation();
        let definition = &definition.definition;
        PropertyType {
            data_type: definition.data_type,
            is_multi_select: definition.is_multi_select || relation,
            specific_entity_type: definition.specific_entity_type.filter(|_| !relation),
            relation,
        }
    }

    /// The property type a [`ColumnKind`] names.
    pub fn from_column_kind(kind: ColumnKind) -> Self {
        let plain = |data_type, is_multi_select| PropertyType {
            data_type,
            is_multi_select,
            specific_entity_type: None,
            relation: false,
        };
        match kind {
            ColumnKind::Text => plain(DataType::String, false),
            ColumnKind::Number => plain(DataType::Number, false),
            ColumnKind::Boolean => plain(DataType::Boolean, false),
            ColumnKind::Date => plain(DataType::Date, false),
            ColumnKind::Link => plain(DataType::Link, false),
            ColumnKind::Select { multi } => plain(DataType::SelectString, multi),
            ColumnKind::SelectNumber { multi } => plain(DataType::SelectNumber, multi),
            ColumnKind::Tag => plain(DataType::Tag, true),
            ColumnKind::Entity { target, multi } => PropertyType {
                specific_entity_type: Some(entity_type(target)),
                ..plain(DataType::Entity, multi)
            },
            ColumnKind::Relation { .. } => PropertyType::RELATION,
        }
    }

    /// A column of this type's values, as the cast rule reads them.
    pub fn cast_kind(&self) -> CastKind {
        let target = self.specific_entity_type.map(entity_kind);
        stored_cast_kind(
            stored_data_type(self.data_type),
            self.is_multi_select,
            target.flatten(),
            self.relation || target == Some(None),
        )
    }
}

/// The [`ColumnKind`] an op names a column's current type by; `None` for a
/// stored type no op can name, a reference without a kind among them.
pub fn column_kind(
    column: &Column,
    definition: &PropertyDefinitionWithOptions,
) -> Option<ColumnKind> {
    if let Some(crate::domain::models::ColumnConfig::Link {
        database_id,
        table_id,
    }) = column.config
    {
        return Some(ColumnKind::Relation {
            database: database_id,
            table: table_id,
        });
    }
    let definition = &definition.definition;
    let multi = definition.is_multi_select;
    Some(match definition.data_type {
        DataType::String => ColumnKind::Text,
        DataType::Number => ColumnKind::Number,
        DataType::Boolean => ColumnKind::Boolean,
        DataType::Date => ColumnKind::Date,
        DataType::Link => ColumnKind::Link,
        DataType::SelectString => ColumnKind::Select { multi },
        DataType::SelectNumber => ColumnKind::SelectNumber { multi },
        DataType::Tag => ColumnKind::Tag,
        DataType::Entity => ColumnKind::Entity {
            target: entity_kind(definition.specific_entity_type?)?,
            multi,
        },
    })
}

/// The database's schema as a batch's journal keeps it: every table's
/// columns, with their options, and views, as `entries` has them.
pub fn schema_image(entries: &[TableEntry]) -> crate::domain::journal::SchemaImage {
    use crate::domain::journal::{ColumnImage, OptionImage, SchemaImage, TableImage};
    let mut image = SchemaImage::default();
    for entry in entries {
        image.tables.push(TableImage {
            id: entry.table.id,
            name: entry.table.name.clone(),
            version: entry.table.version,
        });
        for column in &entry.columns {
            let mut options: Vec<_> = column.definition.property_options.iter().collect();
            options.sort_by_key(|option| option.display_order);
            image.columns.push(ColumnImage {
                id: column.column.id,
                table: entry.table.id,
                name: column.name().to_owned(),
                definition_name: column.definition.definition.display_name.clone(),
                definition: column.definition.definition.id,
                kind: column_kind(&column.column, &column.definition),
                options: options
                    .into_iter()
                    .map(|option| OptionImage {
                        id: OptionId::from_uuid(option.id),
                        label: option_display(&option.value),
                        color: option.color.clone(),
                    })
                    .collect(),
            });
        }
        image.views.extend(entry.views.iter().cloned());
    }
    image
}

/// The menu's types a column holding values can change to: those every
/// value survives, and those whose values are checked first. Its own type
/// is in neither.
pub fn cast_targets(
    column: &Column,
    definition: &PropertyDefinitionWithOptions,
) -> (Vec<ColumnKind>, Vec<ColumnKind>) {
    let current = PropertyType::of(column, definition);
    let from = current.cast_kind();
    let mut safe = Vec::new();
    let mut checked = Vec::new();
    for target in TARGETS {
        if PropertyType::from_column_kind(target) == current {
            continue;
        }
        match cast(from, CastKind::from(target), Contents::Filled) {
            Cast::Safe => safe.push(target),
            Cast::Checked => checked.push(target),
            Cast::Never(_) => {}
        }
    }
    (safe, checked)
}

/// What a reference column points at, as ops name it; `None` for rows of
/// another table (held by relations) and CRM contacts (not a reference-column kind).
pub fn entity_kind(entity_type: models_properties::EntityType) -> Option<EntityKind> {
    use models_properties::EntityType as Stored;
    Some(match entity_type {
        Stored::User => EntityKind::User,
        Stored::Document => EntityKind::Document,
        Stored::Task => EntityKind::Task,
        Stored::Company => EntityKind::Company,
        Stored::CallRecord => EntityKind::CallRecord,
        Stored::Channel => EntityKind::Channel,
        Stored::Chat => EntityKind::Chat,
        Stored::Project => EntityKind::Project,
        Stored::Thread => EntityKind::Thread,
        Stored::CalendarEvent => EntityKind::CalendarEvent,
        Stored::Initiative => EntityKind::Initiative,
        Stored::DatabaseRow | Stored::Contact => return None,
    })
}

/// The properties system's name for what a reference points at.
pub fn entity_type(kind: EntityKind) -> models_properties::EntityType {
    use models_properties::EntityType as Stored;
    match kind {
        EntityKind::User => Stored::User,
        EntityKind::Document => Stored::Document,
        EntityKind::Task => Stored::Task,
        EntityKind::Company => Stored::Company,
        EntityKind::CallRecord => Stored::CallRecord,
        EntityKind::Channel => Stored::Channel,
        EntityKind::Chat => Stored::Chat,
        EntityKind::Project => Stored::Project,
        EntityKind::Thread => Stored::Thread,
        EntityKind::CalendarEvent => Stored::CalendarEvent,
        EntityKind::Initiative => Stored::Initiative,
    }
}

/// A display name as SQL spells it: always double-quoted, an embedded quote
/// doubled, so a client never has to know which names need quoting.
pub fn sql_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// A table as SQL names it: qualified by its database, so every new
/// database's `Table 1` is its own table.
pub fn sql_table_name(database: &str, table: &str) -> String {
    format!("{}.{}", sql_identifier(database), sql_identifier(table))
}

/// An option's label as users write it.
pub fn option_display(value: &PropertyOptionValue) -> String {
    option_value(value).label()
}

/// An option's value in the terms the engine's schema takes.
pub fn option_value(value: &PropertyOptionValue) -> OptionValue {
    match value {
        PropertyOptionValue::String(text) => OptionValue::String(text.clone()),
        PropertyOptionValue::Number(number) => OptionValue::Number(*number),
    }
}

/// Every option of a definition with its label, in display order.
pub fn option_labels(definition: &PropertyDefinitionWithOptions) -> Vec<(OptionId, String)> {
    let mut options: Vec<_> = definition.property_options.iter().collect();
    options.sort_by_key(|option| option.display_order);
    options
        .into_iter()
        .map(|option| {
            (
                OptionId::from_uuid(option.id),
                option_display(&option.value),
            )
        })
        .collect()
}
