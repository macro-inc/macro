#![deny(missing_docs)]
//! Generic grouping primitives for query results.
//!
//! This crate provides types and utilities for grouping items by various fields
//! (date, entity type, project, custom properties) with support for:
//! - Per-group limits and pagination
//! - Group metadata (counts, labels, cursors)
//! - SQL expression builders for common patterns

mod config;
mod date_buckets;
mod field;
mod meta;

pub use config::*;
pub use date_buckets::*;
pub use field::*;
pub use meta::*;
