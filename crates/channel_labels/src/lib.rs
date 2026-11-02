#![deny(missing_docs)]
//! Channel labels: shared or private named groups of chat channels shown in the
//! Chat sidebar, following the hexagonal architecture pattern.
//!
//! Team labels are shared among members; personal labels are private to the
//! authenticated account. Without explicit scope, team members use team labels.
//! Every member of a team sees team labels in the same order and may
//! create, rename, delete, or move channels between them. A member only sees
//! the channels inside a label that they participate in. Empty labels stay
//! visible. Personal labels accept joined team, public, and private channels,
//! but never direct messages.
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
