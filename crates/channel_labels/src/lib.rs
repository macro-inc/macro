#![deny(missing_docs)]
//! Channel labels: shared or private named groups of chat channels shown in the
//! Chat sidebar, following the hexagonal architecture pattern.
//!
//! Every member of a team sees the same labels in the same order and may
//! create, rename, delete, or move channels between them. A member only sees
//! the channels inside a label that they participate in. Empty labels stay
//! visible. Users without a team have labels private to their account.
//! Smart tags match current channel attributes automatically. Their memberships
//! may overlap other tags and manual labels, and only include visible channels.
//!
//! # Architecture
//!
//! - **domain**: models, ports, and the service implementation.
//! - **inbound**: driving adapters (Axum HTTP router).
//! - **outbound**: driven adapters (Postgres repository).

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
