//! The contact graph: who each user knows, built from message and call
//! activity and explicit relationships. Models, ports and the domain service.
//!
//! HTTP and the SQS worker are `contacts_inbound`; the Postgres, SQS and
//! connection gateway adapters are `contacts_outbound`.

#![deny(missing_docs)]

/// Domain models for contact graphs and users.
pub mod models;
/// Port traits defining boundaries between domain and infrastructure.
pub mod ports;
/// Domain service implementing business logic.
pub mod service;
