#![deny(missing_docs)]
//! Backfill and audit for the `source_items` listing projection.
//!
//! Triggers installed by the `source_items` migration keep the table equal to what
//! `entity_access`, the item tables and `document_sub_type` say, for every writer. This crate
//! fills rows for items that predate the triggers and checks the table against its inputs.

pub mod audit;
pub mod backfill;

#[cfg(test)]
mod test;
