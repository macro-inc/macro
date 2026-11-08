//! Identifiers of a database's parts.

use serde::{Deserialize, Serialize};

pub use database_id::{
    ColumnId, DatabaseId, OptionId, PropertyId, QueryId, RowId, TableId, ViewId,
};

/// Monotonic per-table version, bumped once by every committed change to a
/// table's schema or rows. Schema edits name the version they were made
/// against, and change events carry the new one.
#[derive(
    utoipa::ToSchema,
    specta::Type,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
)]
// A version never nears 2^53, so TypeScript reads it as a plain number.
#[specta(type = f64)]
pub struct TableVersion(pub i64);

/// The change journal's id of one committed change: one version of one
/// table that a batch produced. Ids only grow, so a later change of a table
/// has a larger one.
#[derive(
    utoipa::ToSchema,
    specta::Type,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
)]
// An id never nears 2^53, so TypeScript reads it as a plain number.
#[specta(type = f64)]
pub struct ChangeId(pub i64);
