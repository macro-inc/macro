#![deny(missing_docs)]
//! Macro Databases: tables of typed rows whose cells are entity properties,
//! behind a domain service with Axum, agent-tool and Postgres adapters.

pub mod domain;

#[cfg(any(feature = "inbound", feature = "ai_tools"))]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;

#[cfg(feature = "postgres")]
pub mod wiring;
