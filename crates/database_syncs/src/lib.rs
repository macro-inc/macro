#![deny(missing_docs)]
// The end-to-end test's future, over the real databases service, is deep.
#![cfg_attr(test, recursion_limit = "256")]
//! Synced tables: a table of a Macro database kept in sync with an outside
//! source (Granola meetings, a Notion data source) by a background worker.
//! Each run upserts the source's rows by their external id, through the
//! databases service, acting as the sync's creator.

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "postgres")]
pub mod outbound;

#[cfg(feature = "postgres")]
pub mod wiring;
