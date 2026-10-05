#![deny(missing_docs)]
//! The typed write surface of Macro databases: ops, the cast rule, views and
//! position keys, shared by the SQL engine, the HTTP API and the domain.

pub mod cast;
mod ids;
mod ops;
pub mod position;
pub mod property;
pub mod views;

pub use ids::{
    ChangeId, ColumnId, DatabaseId, OptionId, PropertyId, QueryId, RowId, TableId, TableVersion,
    ViewId,
};
pub use ops::{
    CellValue, CellWrite, ColumnChange, ColumnKind, ColumnResult, DatabaseOp, EntityKind,
    EntityRef, NewColumn, NewOption, OpResult, OptionRef, RowChange, RowChanges, RowsChange,
    RowsResult, TableChange, TableResult, TakenId, VersionedTable, ViewChange, ViewResult,
};

/// Longest SQL statement, run or saved, anywhere a statement is accepted.
pub const MAX_STATEMENT_LENGTH: usize = 256 * 1024;
