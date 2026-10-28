//! Schema statements executed by the server through the databases service.
use super::{Identifier, TableName};
use models_databases::ColumnKind;

/// One schema edit. Names are resolved against the caller's visible catalog.
#[derive(Debug, Clone, PartialEq)]
pub enum SchemaStatement {
    /// Create a database with its starter table.
    CreateDatabase(Identifier),
    /// Rename a database.
    RenameDatabase {
        /// Owning database name.
        database: Identifier,
        /// New display name.
        name: Identifier,
    },
    /// Set the order of all tables in a database.
    ReorderTables {
        /// Owning database name.
        database: Identifier,
        /// All table names in display order.
        tables: Vec<Identifier>,
    },
    /// Create a table and its columns atomically.
    CreateTable {
        /// Target table name.
        table: TableName,
        /// Initial columns in order.
        columns: Vec<ColumnDefinition>,
    },
    /// Delete a table and its data.
    DropTable(TableName),
    /// Change a table's structure.
    AlterTable {
        /// Target table name.
        table: TableName,
        /// Schema change.
        change: SchemaChange,
    },
}

/// A named column with optional select labels or a relation target.
#[derive(Debug, Clone, PartialEq)]
pub struct ColumnDefinition {
    /// Column display name.
    pub name: Identifier,
    /// Stored type, or a relation to a named table.
    pub kind: SchemaColumnKind,
    /// Initial option labels.
    pub options: Vec<String>,
}

/// A stored column type or a relation resolved by name.
#[derive(Debug, Clone, PartialEq)]
pub enum SchemaColumnKind {
    /// An ordinary value type.
    Value(ColumnKind),
    /// Row references to another table.
    Relation(TableName),
}

/// One change within an ALTER TABLE statement.
#[derive(Debug, Clone, PartialEq)]
pub enum SchemaChange {
    /// Rename the table.
    Rename(Identifier),
    /// Add a column.
    AddColumn(ColumnDefinition),
    /// Rename a column.
    RenameColumn {
        /// Column name.
        column: Identifier,
        /// New display name.
        name: Identifier,
    },
    /// Delete a column and its values.
    DropColumn(Identifier),
    /// Add select labels.
    AddOptions {
        /// Column name.
        column: Identifier,
        /// Labels to add.
        labels: Vec<String>,
    },
    /// Set the order of every column.
    ReorderColumns(Vec<Identifier>),
    /// Change a column's type, including relation targets.
    ChangeType {
        /// Column name.
        column: Identifier,
        /// Target column type.
        kind: SchemaColumnKind,
    },
}
