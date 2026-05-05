//! This module exposes a dynamic query builder for email threads which can build specific
//! email queries that filter content based on input AST (EmailLiteral).

mod filters;
mod query;

#[cfg(test)]
mod tests;

// Re-export the public API
pub(crate) use query::dynamic_email_thread_cursor;

// Re-export filter internals so tests.rs can reach them via `use super::*`
#[cfg(test)]
pub(crate) use filters::*;

use email_importance::SqlFragment;
