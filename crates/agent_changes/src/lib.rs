#![deny(missing_docs)]
//! The changes an agent session made to its repository, as a reviewable
//! changeset.
//!
//! An agent works somewhere this service cannot see - a Cursor cloud VM, a
//! sandbox, a daemon on someone's laptop - and the transcript only shows the
//! edits its tools reported. This crate owns the other view: the whole diff
//! between the branch the session started from and what it has now, captured
//! after each turn, stored as a patch blob, and served to the Changes pane.
//!
//! Hexagonal, like the rest of the agent stack:
//!
//! - [`domain`] owns the vocabulary ([`domain::model`]), the unified-diff
//!   reader that turns a patch into per-file facts ([`domain::patch`]), the
//!   ports ([`domain::ports`]) - including [`domain::ports::ChangesetExtractor`],
//!   the one trait every harness answers - and the service that captures,
//!   stores, and serves changesets ([`domain::service`]).
//! - [`outbound`] implements the storage and provider ports: Postgres for
//!   the summary row, S3 for the patch, GitHub for comparing a pushed branch,
//!   and a fast model for drafting a pull request.
//! - [`inbound`] is the axum router mounted next to the session routes.
//!
//! The harness-specific extractors live with their harnesses in
//! `agent_harness`, which depends on this crate for the port they implement.

/// Domain models, the patch reader, ports, and the changes service.
pub mod domain;
/// Inbound HTTP adapter.
#[cfg(feature = "inbound")]
pub mod inbound;
/// Adapters implementing the domain ports for external systems.
#[cfg(feature = "outbound")]
pub mod outbound;
/// In-memory port implementations for tests.
#[cfg(any(test, feature = "test-utils"))]
pub mod testing;
