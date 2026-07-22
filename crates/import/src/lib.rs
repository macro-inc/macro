//! The import pipeline: tracking external items (Linear issues, Notion
//! pages, Slack channels) as they are discovered, accepted, and copied into
//! Macro entities.
//!
//! Not to be confused with the `foreign_entity` crate: foreign entities are
//! live references to items that STAY in the external system (e.g. a synced
//! GitHub PR). An [`domain::models::ImportEntity`] is a ledger row for an
//! item being COPIED into Macro — it tracks the item from `staged`
//! (discovered, not yet accepted) through `importing` to `imported` (a Macro
//! entity now exists), or `discarded` (the user declined it).
//!
//! The crate is host-agnostic: onboarding (`/setup`) and AI chat both drive
//! the same primitives, distinguished only by the `initiator` recorded on
//! each row.

#![deny(missing_docs)]

pub mod domain;
pub mod inbound;
pub mod outbound;
