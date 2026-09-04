//! Agent-facing GraphQL listing tool over Soup.
//!
//! One tool, a query string, and a query-only schema. Writes are unrepresentable:
//! [`ReadQuery`] only holds a `query` operation, and the executed schema has no
//! mutation or subscription root.

#![deny(missing_docs)]

mod describe;
mod listing;
mod read_query;
/// The query-only GraphQL schema the tool executes.
pub mod schema;
mod tool;

pub use describe::{DescribeSoup, DescribeSoupResponse, SoupSchemaTopic};
pub use read_query::{QueryRejected, ReadQuery};
pub use tool::{QuerySoup, QuerySoupData};

#[cfg(test)]
mod test;
