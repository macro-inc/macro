//! Building a viewer's SQL catalog from tables, column placements, and the
//! property definitions behind them. Pure functions: the service fetches,
//! this module shapes.
//!
//! Every user table gets a stable SQL name derived from its display name
//! (`Summer Offsite / Guests` → `guests`), a leading `row_id` primary key,
//! one column per placement, and — for every multi-valued or link column — a
//! companion junction view `table__column(row_id, linked_id)` so joins stay
//! flat.

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};

use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::shared::{DataType, EntityType as PropertyEntityType};

use crate::domain::models::{
    AccessGrant, Column, ColumnConfig, ColumnId, ColumnSchema, DatabaseId, ForeignKey,
    PropertyDefinitionId, SqlType, Table, TableId, TableSchema, TableSource,
};

/// The reserved primary-key column of every user table.
pub const ROW_ID: &str = "row_id";
/// The second column of every junction view.
pub const LINKED_ID: &str = "linked_id";

/// One user table as it appears in the catalog, with the bookkeeping needed
/// to materialize it and to translate changes back.
#[derive(Debug, Clone)]
pub struct TableEntry {
    /// The table.
    pub table: Table,
    /// The viewer's grant on the owning database.
    pub grant: AccessGrant,
    /// The main table schema (`row_id` first).
    pub schema: TableSchema,
    /// Placements in schema order (parallel to `schema.columns[1..]`).
    pub columns: Vec<ColumnEntry>,
    /// Junction views derived from multi-valued and link columns.
    pub junctions: Vec<JunctionEntry>,
}

/// One column placement with its definition and SQL name.
#[derive(Debug, Clone)]
pub struct ColumnEntry {
    /// The placement.
    pub column: Column,
    /// The definition behind it.
    pub definition: PropertyDefinitionWithOptions,
    /// SQL name within the table.
    pub sql_name: String,
    /// Whether SQL may write this column.
    pub writable: bool,
}

/// A junction view: `(row_id, linked_id)` pairs for one column.
#[derive(Debug, Clone)]
pub struct JunctionEntry {
    /// The column the junction belongs to.
    pub column_id: ColumnId,
    /// Whether it carries link edges (writable) or multi-valued cell contents
    /// (read-only mirror of the JSON column).
    pub kind: JunctionKind,
    /// Its schema.
    pub schema: TableSchema,
}

/// What a junction view mirrors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JunctionKind {
    /// Edges of a link column (`database_row_links`).
    Link,
    /// Elements of a multi-valued cell (select options, entity refs, links).
    MultiValue,
}

/// Turn a display name into a SQL identifier: lowercase, non-alphanumerics
/// collapsed to `_`, never empty, never starting with a digit.
pub fn sql_identifier(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_underscore = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_underscore = false;
        } else if !last_underscore && !out.is_empty() {
            out.push('_');
            last_underscore = true;
        }
    }
    while out.ends_with('_') {
        out.pop();
    }
    if out.is_empty() {
        return "t".to_string();
    }
    if out.starts_with(|c: char| c.is_ascii_digit()) {
        out.insert(0, '_');
    }
    out
}

/// A display value for a select option, as SQL sees it.
pub fn option_display(value: &PropertyOptionValue) -> String {
    match value {
        PropertyOptionValue::String(s) => s.clone(),
        PropertyOptionValue::Number(n) => format_number(*n),
    }
}

/// Numbers print without a trailing `.0` when integral, matching how users
/// type them in SQL.
pub fn format_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        n.to_string()
    }
}

/// Map a property entity type to the platform entity type chips hydrate.
pub fn entity_type_for(property_type: PropertyEntityType) -> Option<model_entity::EntityType> {
    use model_entity::EntityType as E;
    Some(match property_type {
        PropertyEntityType::User => E::User,
        PropertyEntityType::Document | PropertyEntityType::Task => E::Document,
        PropertyEntityType::Company => E::CrmCompany,
        PropertyEntityType::CallRecord => E::Call,
        PropertyEntityType::Channel => E::Channel,
        PropertyEntityType::Chat => E::Chat,
        PropertyEntityType::Project => E::Project,
        PropertyEntityType::Thread => E::EmailThread,
        PropertyEntityType::CalendarEvent => E::CalendarEvent,
    })
}

fn unique_name(base: &str, taken: &mut HashSet<String>, disambiguator: &str) -> String {
    if taken.insert(base.to_string()) {
        return base.to_string();
    }
    let candidate = format!("{base}_{disambiguator}");
    if taken.insert(candidate.clone()) {
        return candidate;
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base}_{disambiguator}_{n}");
        if taken.insert(candidate.clone()) {
            return candidate;
        }
        n += 1;
    }
}

fn short_id(id: uuid::Uuid) -> String {
    id.simple().to_string()[..6].to_string()
}

fn row_id_column() -> ColumnSchema {
    ColumnSchema {
        sql_name: ROW_ID.to_string(),
        sql_type: SqlType::Text,
        data_type: None,
        is_multi_select: false,
        definition_id: None,
        entity_type: None,
        // Inserts default it; updates to it are refused.
        writable: false,
        allowed_values: None,
        not_null: true,
    }
}

fn column_schema(
    sql_name: &str,
    definition: &PropertyDefinitionWithOptions,
    is_link: bool,
    writable: bool,
) -> ColumnSchema {
    let def = &definition.definition;
    let multi = def.is_multi_select || is_link;
    let allowed_values = match def.data_type {
        DataType::SelectString | DataType::SelectNumber | DataType::Tag => Some(
            definition
                .property_options
                .iter()
                .map(|o| option_display(&o.value))
                .collect(),
        ),
        _ => None,
    };
    ColumnSchema {
        sql_name: sql_name.to_string(),
        sql_type: if is_link {
            SqlType::Text
        } else {
            SqlType::for_data_type(def.data_type, def.is_multi_select)
        },
        data_type: Some(def.data_type),
        is_multi_select: multi,
        definition_id: Some(def.id),
        entity_type: match def.data_type {
            DataType::Entity => def.specific_entity_type.and_then(entity_type_for),
            _ => None,
        },
        // Link cells are edges: written through the junction, read as JSON.
        writable: writable && !is_link,
        allowed_values,
        not_null: false,
    }
}

fn junction_schema(
    table_sql: &str,
    column_sql: &str,
    writable: bool,
    table_id: TableId,
    column_id: ColumnId,
) -> TableSchema {
    let key = |name: &str| ColumnSchema {
        sql_name: name.to_string(),
        sql_type: SqlType::Text,
        data_type: None,
        is_multi_select: false,
        definition_id: None,
        entity_type: None,
        writable,
        allowed_values: None,
        not_null: true,
    };
    TableSchema {
        sql_name: format!("{table_sql}__{column_sql}"),
        source: TableSource::Junction {
            table_id,
            column_id,
        },
        columns: vec![key(ROW_ID), key(LINKED_ID)],
        primary_key: vec![ROW_ID.to_string(), LINKED_ID.to_string()],
        foreign_keys: vec![ForeignKey {
            column: ROW_ID.to_string(),
            references_table: table_sql.to_string(),
            references_column: ROW_ID.to_string(),
        }],
        writable,
    }
}

/// Build catalog entries for every user table the viewer can reach.
///
/// `tables` should be ordered (database, position) so SQL-name collisions
/// resolve deterministically: the first table keeps the bare name, later ones
/// get a short id suffix. Lookup columns are derived and not materialized in
/// this version; columns whose definition is missing are skipped.
pub fn build_user_tables(
    tables: &[Table],
    columns: &[Column],
    definitions: &HashMap<PropertyDefinitionId, PropertyDefinitionWithOptions>,
    grants: &HashMap<DatabaseId, AccessGrant>,
) -> Vec<TableEntry> {
    let mut taken_tables: HashSet<String> = HashSet::new();
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
            let writable = grant.can_write();
            let table_sql = unique_name(
                &sql_identifier(&table.name),
                &mut taken_tables,
                &short_id(table.id),
            );

            let mut taken_columns: HashSet<String> = [ROW_ID.to_string()].into_iter().collect();
            let mut schema_columns = vec![row_id_column()];
            let mut entries = Vec::new();
            let mut junctions = Vec::new();

            for column in columns_by_table.get(&table.id).into_iter().flatten() {
                if matches!(column.config, Some(ColumnConfig::Lookup { .. })) {
                    continue;
                }
                let Some(definition) = definitions.get(&column.property_definition_id) else {
                    continue;
                };
                let is_link = matches!(column.config, Some(ColumnConfig::Link { .. }));
                let column_sql = unique_name(
                    &sql_identifier(&definition.definition.display_name),
                    &mut taken_columns,
                    &short_id(column.id),
                );
                let schema = column_schema(&column_sql, definition, is_link, writable);
                if schema.is_multi_select {
                    let kind = if is_link {
                        JunctionKind::Link
                    } else {
                        JunctionKind::MultiValue
                    };
                    junctions.push(JunctionEntry {
                        column_id: column.id,
                        kind,
                        schema: junction_schema(
                            &table_sql,
                            &column_sql,
                            writable && kind == JunctionKind::Link,
                            table.id,
                            column.id,
                        ),
                    });
                }
                entries.push(ColumnEntry {
                    column: (*column).clone(),
                    definition: definition.clone(),
                    sql_name: column_sql,
                    writable: schema.writable,
                });
                schema_columns.push(schema);
            }

            Some(TableEntry {
                table: table.clone(),
                grant,
                schema: TableSchema {
                    sql_name: table_sql,
                    source: TableSource::UserTable(table.id),
                    columns: schema_columns,
                    primary_key: vec![ROW_ID.to_string()],
                    foreign_keys: vec![],
                    writable,
                },
                columns: entries,
                junctions,
            })
        })
        .collect()
}

/// Every schema the entries contribute to the catalog, junctions included.
pub fn schemas(entries: &[TableEntry]) -> impl Iterator<Item = TableSchema> + '_ {
    entries.iter().flat_map(|entry| {
        std::iter::once(entry.schema.clone())
            .chain(entry.junctions.iter().map(|j| j.schema.clone()))
    })
}
