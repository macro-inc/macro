#![deny(missing_docs)]
//! Collab surfaces: stable ids for arbitrary collaborative markdown surfaces,
//! following the hexagonal architecture pattern.
//!
//! A collab surface gives any markdown UI (an input box, a message editor, a
//! task field) its own Loro CRDT session in sync-service, independent of the
//! `Document` table. The CRDT is the durable source of truth for content; the
//! `collab_surfaces` table records only existence, the parent entity, and
//! lifecycle state.
//!
//! A surface has no owner: it is a shared fixture of its parent entity (e.g. a
//! channel's shared input box). All authorization — creating a surface,
//! minting a sync-service connection token, deleting — derives from the
//! caller's access to the parent entity.
//!
//! # Architecture
//!
//! - **domain**: domain models, ports, and the service implementation.
//! - **inbound**: driving adapters (Axum HTTP router).
//! - **outbound**: driven adapters (Postgres repository, lexical/sync-service
//!   initializer).

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
