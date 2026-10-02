//! Schema SQL uses the same receipt-gated service and atomic ops as the UI.
use super::*;
use crate::outcome::SqlStatement;
use database_sql::parse::schema::{
    ColumnDefinition, SchemaChange, SchemaColumnKind, SchemaStatement,
};
use database_sql::parse::{Identifier, TableName};
use databases::domain::models::{CreateDatabase, OpBatch};
use models_databases::{
    ColumnChange, ColumnId, ColumnKind, DatabaseOp, NewColumn, NewOption, OptionId, TableChange,
};

fn refused(reason: impl Into<String>) -> SqlError {
    SqlError::WriteRefused {
        row: None,
        reason: reason.into(),
    }
}
fn database<'a>(
    catalog: &'a ViewerCatalog,
    name: Option<&Identifier>,
    scope: Option<DatabaseId>,
) -> Result<&'a databases::domain::models::DatabaseDetail, SqlError> {
    let matches: Vec<_> = catalog
        .databases
        .iter()
        .filter(|database| match name {
            Some(name) => database.database.name.eq_ignore_ascii_case(&name.0),
            None => scope == Some(database.database.id),
        })
        .collect();
    if let Some(scoped) = matches
        .iter()
        .find(|database| Some(database.database.id) == scope)
    {
        return Ok(scoped);
    }
    let exact: Vec<_> = matches
        .iter()
        .copied()
        .filter(|database| name.is_some_and(|name| database.database.name == name.0))
        .collect();
    let matches = if exact.len() == 1 { exact } else { matches };
    match matches.as_slice() {
        [database] => Ok(database),
        [] => Err(refused(
            "Database not found. Pass databaseId or qualify the table with a database from ListDatabases.",
        )),
        _ => Err(refused(
            "Ambiguous database name. Pass databaseId from ListDatabases to select one.",
        )),
    }
}
fn table<'a>(
    catalog: &'a ViewerCatalog,
    name: &TableName,
) -> Result<&'a database_sql::catalog::Table, SqlError> {
    database_sql::resolve::named_table(catalog.catalog(), name)
        .map_err(|error| SqlError::Compile(CompileError::Resolve(error)))
}
fn column(table: &database_sql::catalog::Table, name: &Identifier) -> Result<ColumnId, SqlError> {
    database_sql::resolve::named_column(table, name)
        .map(|column| column.placement)
        .map_err(|error| SqlError::Compile(CompileError::Resolve(error)))
}
fn kind(catalog: &ViewerCatalog, value: &SchemaColumnKind) -> Result<ColumnKind, SqlError> {
    Ok(match value {
        SchemaColumnKind::Value(kind) => *kind,
        SchemaColumnKind::Relation(name) => {
            let table = table(catalog, name)?;
            ColumnKind::Relation {
                database: table.database_id,
                table: table.id,
            }
        }
    })
}
fn create_column(
    catalog: &ViewerCatalog,
    table: TableId,
    definition: &ColumnDefinition,
) -> Result<DatabaseOp, SqlError> {
    Ok(DatabaseOp::Column {
        table,
        column: ColumnId::new(),
        change: ColumnChange::Create {
            definition: NewColumn::New {
                name: definition.name.0.clone(),
                kind: kind(catalog, &definition.kind)?,
                options: definition
                    .options
                    .iter()
                    .map(|label| NewOption {
                        id: OptionId::new(),
                        label: label.clone(),
                    })
                    .collect(),
                infer_type: false,
            },
            after: None,
        },
    })
}
fn outcome(
    database_id: DatabaseId,
    summary: String,
    versions: HashMap<TableId, TableVersion>,
) -> SqlOutcome {
    SqlOutcome {
        result: None,
        changes_applied: 0,
        inserted_row_ids: Vec::new(),
        new_versions: versions,
        read_versions: HashMap::new(),
        truncated_tables: Vec::new(),
        statement: SqlStatement::Schema {
            database_id,
            summary,
        },
    }
}

impl<
    Databases: DatabasesService,
    Access: EntityAccessService,
    Soup: SoupService,
    Contacts: ContactsService,
> DatabasesSql<Databases, Access, Soup, Contacts>
{
    pub(super) async fn execute_schema(
        &self,
        viewer: Viewer,
        request: SqlRequest,
        command: SchemaStatement,
    ) -> Result<SqlOutcome, SqlError> {
        // Creation has no existing entity on which to mint a receipt. This also
        // caps that capability on document-answer hosts using view_only().
        if self.read_only {
            return Err(refused("This SQL surface is read-only."));
        }
        if let SchemaStatement::CreateDatabase(name) = command {
            let created = self
                .databases
                .create_database(CreateDatabase {
                    name: name.0,
                    owner_id: viewer.user_id,
                    acting_bot: viewer.acting_bot,
                })
                .await
                .map_err(schema_error)?;
            return Ok(outcome(
                created.id,
                format!(
                    "Created database \"{}\". Call DescribeDatabase for its starter table and column IDs.",
                    created.name
                ),
                HashMap::new(),
            ));
        }
        let catalog = self.catalog(&viewer, request.scope).await?;
        let mut ops = Vec::new();
        let (database_id, summary, rename) = match command {
            SchemaStatement::CreateDatabase(_) => unreachable!("handled before catalog read"),
            SchemaStatement::RenameDatabase {
                database: name,
                name: new_name,
            } => {
                let database = database(&catalog, Some(&name), request.scope)?;
                (
                    database.database.id,
                    format!("Renamed database to \"{}\".", new_name.0),
                    Some(new_name.0),
                )
            }
            SchemaStatement::ReorderTables {
                database: name,
                tables,
            } => {
                let database = database(&catalog, Some(&name), request.scope)?;
                let order = tables
                    .iter()
                    .map(|name| {
                        table(
                            &catalog,
                            &TableName {
                                database: Some(Identifier(database.database.name.clone())),
                                table: name.clone(),
                            },
                        )
                        .map(|table| table.id)
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                ops.push(DatabaseOp::ReorderTables { order });
                (database.database.id, "Reordered tables.".into(), None)
            }
            SchemaStatement::CreateTable {
                table: name,
                columns,
            } => {
                let database = database(&catalog, name.database.as_ref(), request.scope)?;
                let table = TableId::new();
                ops.push(DatabaseOp::Table {
                    table,
                    change: TableChange::Create {
                        name: name.table.0.clone(),
                    },
                });
                for definition in &columns {
                    ops.push(create_column(&catalog, table, definition)?);
                }
                (
                    database.database.id,
                    format!(
                        "Created table \"{}\" ({table}). Call DescribeDatabase for its columns.",
                        name.table.0
                    ),
                    None,
                )
            }
            SchemaStatement::DropTable(name) => {
                let table = table(&catalog, &name)?;
                ops.push(DatabaseOp::Table {
                    table: table.id,
                    change: TableChange::Delete,
                });
                (
                    table.database_id,
                    format!("Deleted table \"{}\".", table.name),
                    None,
                )
            }
            SchemaStatement::AlterTable {
                table: name,
                change,
            } => {
                let table = table(&catalog, &name)?;
                let op = match change {
                    SchemaChange::Rename(name) => DatabaseOp::Table {
                        table: table.id,
                        change: TableChange::Rename {
                            name: name.0,
                            previous_name: Some(table.name.clone()),
                        },
                    },
                    SchemaChange::AddColumn(definition) => {
                        create_column(&catalog, table.id, &definition)?
                    }
                    SchemaChange::DropColumn(name) => DatabaseOp::Column {
                        table: table.id,
                        column: column(table, &name)?,
                        change: ColumnChange::Delete,
                    },
                    SchemaChange::RenameColumn {
                        column: name,
                        name: new_name,
                    } => DatabaseOp::Column {
                        table: table.id,
                        column: column(table, &name)?,
                        change: ColumnChange::Rename {
                            name: new_name.0,
                            previous_name: Some(
                                database_sql::resolve::named_column(table, &name)
                                    .map_err(|error| {
                                        SqlError::Compile(CompileError::Resolve(error))
                                    })?
                                    .name
                                    .clone(),
                            ),
                        },
                    },
                    SchemaChange::AddOptions {
                        column: name,
                        labels,
                    } => DatabaseOp::Column {
                        table: table.id,
                        column: column(table, &name)?,
                        change: ColumnChange::AddOptions {
                            options: labels
                                .into_iter()
                                .map(|label| NewOption {
                                    id: OptionId::new(),
                                    label,
                                })
                                .collect(),
                        },
                    },
                    SchemaChange::ReorderColumns(names) => DatabaseOp::Table {
                        table: table.id,
                        change: TableChange::ReorderColumns {
                            order: names
                                .iter()
                                .map(|name| column(table, name))
                                .collect::<Result<Vec<_>, _>>()?,
                        },
                    },
                    SchemaChange::ChangeType {
                        column: name,
                        kind: to,
                    } => DatabaseOp::Column {
                        table: table.id,
                        column: column(table, &name)?,
                        change: ColumnChange::ChangeType {
                            to: kind(&catalog, &to)?,
                        },
                    },
                };
                ops.push(op);
                (
                    table.database_id,
                    format!(
                        "Changed schema of \"{}\". Call DescribeDatabase for the current schema.",
                        table.name
                    ),
                    None,
                )
            }
        };
        let receipt = database_receipt::<EditAccessLevel, _>(
            self.entity_access.as_ref(),
            &viewer,
            database_id,
        )
        .await
        .map_err(|error| match error {
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
                SqlError::TableReadOnly {
                    table: database_id.to_string(),
                }
            }
            AccessError::NotFound(_) => SqlError::NotFound,
            other => SqlError::Infrastructure(rootcause::Report::new(other).into_dynamic()),
        })?;
        if let Some(name) = rename {
            self.databases
                .rename_database(receipt, name)
                .await
                .map_err(schema_error)?;
            return Ok(outcome(database_id, summary, HashMap::new()));
        }
        // Guard only tables written by this statement, under the domain transaction's locks.
        let base_versions = request
            .base_versions
            .into_iter()
            .filter(|(table, _)| {
                ops.iter().any(|op| {
                    op.table() == Some(*table)
                        || matches!(op, DatabaseOp::ReorderTables {order} if order.contains(table))
                })
            })
            .collect();
        let written: Vec<_> = ops.iter().map(DatabaseOp::table).collect();
        let results = self
            .databases
            .apply_ops(receipt, viewer, OpBatch { ops, base_versions })
            .await
            .map_err(schema_error)?;
        let mut versions = HashMap::new();
        for (table, result) in written.into_iter().zip(&results) {
            if let models_databases::OpResult::ReorderTables { tables } = result {
                versions.extend(tables.iter().map(|entry| (entry.table, entry.version)));
            } else if let (Some(table), Some(version)) = (table, result.table_version()) {
                versions.insert(table, version);
            }
        }
        Ok(outcome(database_id, summary, versions))
    }
}

fn schema_error(error: DatabaseError) -> SqlError {
    match error {
        DatabaseError::Repo(report) => SqlError::Infrastructure(report),
        DatabaseError::NotFound | DatabaseError::Unauthorized => SqlError::NotFound,
        DatabaseError::InvalidOp(refusal) => SqlError::WriteRefused {
            row: refusal.row.map(|row| row + 1),
            reason: refusal.reason,
        },
        other => refused(other.to_string()),
    }
}
