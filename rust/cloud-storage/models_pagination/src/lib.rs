#![deny(missing_docs)]
//! This crate supplies the method of pagination for macro.
//! This is implemented in both a typesafe and generic way which allows for creating pagination off of an Iterator that satisfies the following pillars.
//! 1. The [Iterator::Item] must implement [Identify], so that we can get the unique id of the item.
//! 2. The sort method you are trying to paginate over must implment [Sortable], this is how we declare what type the sort is occuring on e.g. `DateTime<Utc>`
//! 3. The [Iterator::Item] must implement [SortOn] for the desired [Sortable]

#[cfg(feature = "axum")]
mod axum;
mod cursor;
mod sort;

#[cfg(feature = "axum")]
pub use axum::*;
pub use cursor::*;
pub use sort::*;
