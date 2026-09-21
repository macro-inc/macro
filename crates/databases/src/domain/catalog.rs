//! Building a viewer's SQL catalog from tables, column placements, and the
//! property definitions behind them. Pure functions: the service fetches,
//! this module shapes.
//!
//! Every user table gets a SQL name derived from its display name
//! (`Summer Offsite / Guests` → `guests`), an immutable read alias for saved
//! queries, a leading `row_id` primary key,
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
    AccessGrant, Column, ColumnConfig, ColumnId, ColumnSchema, Database, DatabaseId, ForeignKey,
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
/// collapsed to `_`, never empty, never starting with a digit, never in
/// SQLite's reserved `sqlite_` namespace.
pub fn sql_identifier(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_underscore = false;
    for ch in name.chars() {
        if ch.is_alphanumeric() {
            out.extend(ch.to_lowercase());
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
    if out.starts_with(|c: char| c.is_ascii_digit()) || out.starts_with("sqlite_") {
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

/// The SQL label of every option of a definition, in display order. Two
/// options with the same display text are disambiguated (`Done`, `Done (2)`)
/// so labels round-trip to exactly one option id in both directions.
pub fn option_labels(definition: &PropertyDefinitionWithOptions) -> Vec<(uuid::Uuid, String)> {
    let mut options: Vec<_> = definition.property_options.iter().collect();
    options.sort_by_key(|o| (o.display_order, o.id));
    let mut taken: HashSet<String> = HashSet::new();
    options
        .into_iter()
        .map(|option| {
            let base = option_display(&option.value);
            let mut label = base.clone();
            let mut n = 2;
            while !taken.insert(label.clone()) {
                label = format!("{base} ({n})");
                n += 1;
            }
            (option.id, label)
        })
        .collect()
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
pub fn entity_type_for(property_type: PropertyEntityType) -> model_entity::EntityType {
    use model_entity::EntityType as E;
    match property_type {
        PropertyEntityType::User => E::User,
        PropertyEntityType::Document | PropertyEntityType::Task => E::Document,
        PropertyEntityType::Company => E::CrmCompany,
        PropertyEntityType::CallRecord => E::Call,
        PropertyEntityType::Channel => E::Channel,
        PropertyEntityType::Chat => E::Chat,
        PropertyEntityType::Project => E::Project,
        PropertyEntityType::Thread => E::EmailThread,
        PropertyEntityType::CalendarEvent => E::CalendarEvent,
    }
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
            option_labels(definition)
                .into_iter()
                .map(|(_, label)| label)
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
            DataType::Entity => def.specific_entity_type.map(entity_type_for),
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
    table_aliases: &[String],
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
        aliases: table_aliases
            .iter()
            .map(|alias| format!("{alias}__{column_sql}"))
            .collect(),
    }
}

/// The preferred database-qualified SQL name of a table:
/// `<database>_<full database id>__<table>`. UUIDv7 prefixes encode time,
/// so a truncated id cannot distinguish databases created near each other.
pub fn qualified_table_name(database: &Database, table_sql: &str) -> String {
    format!(
        "{}_{}__{}",
        sql_identifier(&database.name),
        database.id.simple(),
        table_sql
    )
}

fn legacy_qualified_table_name(database: &Database, table_sql: &str) -> String {
    format!(
        "{}_{}__{}",
        sql_identifier(&database.name),
        short_id(database.id),
        table_sql
    )
}

/// Immutable read alias for saved answers. Display-name-derived identifiers
/// cannot begin with this prefix, so user names cannot shadow it.
pub fn read_table_name(table_id: TableId) -> String {
    format!("_macro_table_{}", table_id.simple())
}

/// Build catalog entries for every user table the viewer can reach.
///
/// Naming is designed so a persisted query never silently resolves to a
/// different table depending on who runs it:
///
/// - Within a database, table SQL names derive from the table name. All
///   normalized duplicates get a full table-ID suffix, and none gets the
///   ambiguous bare name, regardless of input order.
/// - Qualified names use the full database ID. Legacy short-ID names remain
///   as read aliases only when unambiguous across the entire SQL namespace.
/// - Its immutable read alias depends only on its table ID. Saved answers use
///   this alias so renames and other databases cannot invalidate their source.
/// - The bare name (`guests`) exists only when exactly one table across the
///   viewer's whole catalog claims it and it collides with no `reserved` name
///   (magic tables). When a second `guests` appears the bare name disappears
///   and statements using it fail loudly with "no such table" rather than
///   picking one.
/// - Tables, aliases, and junctions share SQLite's case-insensitive namespace.
///   Any conflicting display-derived name is omitted; a physical table that
///   needs another name gets an internal UUID name. Immutable read aliases
///   remain addressable regardless of display-name collisions.
///
/// Whichever form is not the physical table is compiled as a `CREATE VIEW`,
/// so **writes must name [`TableSchema::sql_name`]**; a statement writing
/// through an alias in [`TableSchema::aliases`] is rejected as read-only
/// rather than applied. Reads may use either name.
///
/// Lookup columns are derived and not materialized in this version; columns
/// whose definition is missing are skipped.
pub fn build_user_tables(
    databases: &[Database],
    tables: &[Table],
    columns: &[Column],
    definitions: &HashMap<PropertyDefinitionId, PropertyDefinitionWithOptions>,
    grants: &HashMap<DatabaseId, AccessGrant>,
    reserved: &[String],
) -> Vec<TableEntry> {
    let databases_by_id: HashMap<DatabaseId, &Database> =
        databases.iter().map(|d| (d.id, d)).collect();
    let mut columns_by_table: HashMap<TableId, Vec<&Column>> = HashMap::new();
    for column in columns {
        columns_by_table
            .entry(column.table_id)
            .or_default()
            .push(column);
    }

    // Count normalized display names before allocating any SQL names, so
    // ordering cannot give one duplicate another table's previous name.
    let named_tables: Vec<_> = tables
        .iter()
        .filter(|table| {
            grants.contains_key(&table.database_id)
                && databases_by_id.contains_key(&table.database_id)
        })
        .map(|table| (table, sql_identifier(&table.name)))
        .collect();
    let mut per_database_claims: HashMap<DatabaseId, HashMap<String, usize>> = HashMap::new();
    for (table, name) in &named_tables {
        *per_database_claims
            .entry(table.database_id)
            .or_default()
            .entry(name.clone())
            .or_default() += 1;
    }
    let mut base_names: HashMap<TableId, (String, bool)> = HashMap::new();
    let mut claims: HashMap<String, usize> = reserved
        .iter()
        .map(|name| (name.to_ascii_lowercase(), 2))
        .collect();
    for (table, name) in named_tables {
        let unambiguous = per_database_claims[&table.database_id][&name] == 1;
        *claims.entry(name.clone()).or_default() += 1;
        let table_sql = if unambiguous {
            name
        } else {
            format!("{name}_{}", table.id.simple())
        };
        base_names.insert(table.id, (table_sql, unambiguous));
    }

    let mut entries: Vec<_> = tables
        .iter()
        .filter_map(|table| {
            let grant = *grants.get(&table.database_id)?;
            let database = databases_by_id.get(&table.database_id)?;
            let writable = grant.can_write();
            let (table_sql, unambiguous) = base_names.get(&table.id)?;
            let qualified = qualified_table_name(database, table_sql);
            let bare_available = *unambiguous && claims.get(table_sql).copied().unwrap_or(0) == 1;
            let (physical, mut aliases) = if bare_available {
                (table_sql.clone(), vec![qualified])
            } else {
                (qualified, Vec::new())
            };
            aliases.push(legacy_qualified_table_name(database, table_sql));
            aliases.push(read_table_name(table.id));

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
                            &physical,
                            &aliases,
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
                    sql_name: physical,
                    source: TableSource::UserTable(table.id),
                    columns: schema_columns,
                    primary_key: vec![ROW_ID.to_string()],
                    foreign_keys: vec![],
                    writable,
                    aliases,
                },
                columns: entries,
                junctions,
            })
        })
        .collect();
    resolve_namespace_conflicts(&mut entries, reserved);
    entries
}

/// All schema objects must be considered together: a bare junction name can
/// equal a different table's qualified alias, and a magic table can reserve
/// either one. Ambiguous names disappear rather than changing their owner.
fn resolve_namespace_conflicts(entries: &mut [TableEntry], reserved: &[String]) {
    let mut claims: HashMap<String, usize> = reserved
        .iter()
        .map(|name| (name.to_ascii_lowercase(), 1))
        .collect();
    for schema in entries.iter().flat_map(|entry| {
        std::iter::once(&entry.schema)
            .chain(entry.junctions.iter().map(|junction| &junction.schema))
    }) {
        for name in std::iter::once(&schema.sql_name).chain(&schema.aliases) {
            *claims.entry(name.to_ascii_lowercase()).or_default() += 1;
        }
    }
    let mut taken: HashSet<String> = claims.keys().cloned().collect();
    let resolve = |schema: &mut TableSchema, fallback: String, taken: &mut HashSet<String>| {
        if claims[&schema.sql_name.to_ascii_lowercase()] > 1 {
            schema.sql_name = unique_name(&fallback, taken, "internal");
        }
        schema
            .aliases
            .retain(|name| claims[&name.to_ascii_lowercase()] == 1);
    };
    for entry in entries {
        let previous_name = entry.schema.sql_name.clone();
        resolve(
            &mut entry.schema,
            format!("_macro_storage_table_{}", entry.table.id.simple()),
            &mut taken,
        );
        for junction in &mut entry.junctions {
            resolve(
                &mut junction.schema,
                format!("_macro_storage_junction_{}", junction.column_id.simple()),
                &mut taken,
            );
            for foreign_key in &mut junction.schema.foreign_keys {
                if foreign_key.references_table == previous_name {
                    foreign_key.references_table = entry.schema.sql_name.clone();
                }
            }
        }
    }
}

/// Whether `name` addresses `entry` (its table or one of its aliases).
pub fn entry_answers_to(entry: &TableEntry, name: &str) -> bool {
    entry.schema.sql_name == name || entry.schema.aliases.iter().any(|a| a == name)
}

/// Whether `name` addresses `junction` (its physical name or an alias).
pub fn junction_answers_to(junction: &JunctionEntry, name: &str) -> bool {
    junction.schema.sql_name == name || junction.schema.aliases.iter().any(|a| a == name)
}

/// Every schema the entries contribute to the catalog, junctions included.
pub fn schemas(entries: &[TableEntry]) -> impl Iterator<Item = TableSchema> + '_ {
    entries.iter().flat_map(|entry| {
        std::iter::once(entry.schema.clone())
            .chain(entry.junctions.iter().map(|j| j.schema.clone()))
    })
}
