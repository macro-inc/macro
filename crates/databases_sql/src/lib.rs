//! SQL over Macro databases for agents: the `database_sql` engine run over
//! Soup, contacts and the databases service's ops, as the viewer.
#![deny(missing_docs)]

mod catalog;
mod ops_sink;
mod outcome;
mod row_source;
mod service;
#[cfg(test)]
mod test_support;
#[cfg(feature = "ai_tools")]
pub mod toolset;
mod view_only;

pub use outcome::{ResultColumn, ResultSet, SqlOutcome, SqlStatement};
pub use service::{ChartColumns, DatabasesSql, SqlError, SqlRequest};
pub use view_only::ViewOnlyAccess;
