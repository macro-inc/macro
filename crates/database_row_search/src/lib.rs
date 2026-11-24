#![deny(missing_docs)]
//! Postgres reads for database row search.
//!
//! [`read_row_search_text`] is the one definition of what a row offers to
//! search. The indexer writes it into the `database_rows` index, and search
//! recomputes it from the primary database before showing a hit, so the two
//! can never disagree about what a row says.
//!
//! [`index`] holds the indexer's other reads: the change journal, row and
//! database paging, and the per-table watermark recording how far the index
//! has caught up.

pub mod index;
mod read;
mod visible_text;

pub use read::{MAX_ROWS_PER_READ, ReadError, RowSearchText, read_row_search_text};
