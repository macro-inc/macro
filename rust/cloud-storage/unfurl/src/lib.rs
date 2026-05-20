#![deny(missing_docs)]
//! Hexagonal crate for the URL unfurl feature.
//!
//! - `domain` — pure models, ports, and service logic (no I/O deps).
//! - `inbound` — HTTP / tool adapters that drive the domain.
//! - `outbound` — concrete adapters the domain drives (e.g. the reqwest-backed
//!   meta-tag fetcher).

pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;
