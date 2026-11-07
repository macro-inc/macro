#![deny(missing_docs)]
//! Facade over the split contacts crates, kept so existing imports such as
//! `contacts::domain::service` and `contacts::outbound::repository` still
//! work.
//!
//! New code should depend on the layer it needs: `contacts_core` for models,
//! ports and the service, `contacts_inbound` for HTTP and the SQS worker, and
//! `contacts_outbound` for the Postgres, SQS and connection gateway adapters.

/// Models, ports and the domain service (`contacts_core`).
pub use contacts_core as domain;

/// HTTP handlers and the SQS worker (`contacts_inbound`).
#[cfg(feature = "axum")]
pub use contacts_inbound as inbound;

/// Postgres, SQS and connection gateway adapters (`contacts_outbound`).
#[cfg(feature = "outbound")]
pub use contacts_outbound as outbound;
