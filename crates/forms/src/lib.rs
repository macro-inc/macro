#![deny(missing_docs)]
//! Macro Forms: questionnaires that are views of a database table, behind a
//! domain service with Axum and Postgres adapters. Answers land as rows of
//! the table through the databases service; the form keeps presentation and
//! a ledger of who responded.

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;

#[cfg(feature = "postgres")]
pub mod wiring;
