#![deny(missing_docs)]
//! The sync-router: forwards sync-protocol frames between the host's local sockets and a per-document downstream.
//!
//! Chapter 1: the downstream is the existing Cloudflare Durable Object
//! sync-service, dialed per `(connection, document)` so the DO sees each user
//! as an ordinary peer. The router parses only the multiplex envelope
//! ([`sync_service_bebop_schema`]'s `ToRouter`/`FromRouter`); inner sync
//! payloads pass through untouched.
//!
//! Chapter 2 swaps the [`domain::ports::DownstreamFactory`] implementation for
//! one that consistent-hashes document ids across native sync services. The
//! router core does not change.

pub mod domain;
pub mod outbound;

/// Socket lifecycle and upstream adapter composition.
pub mod session;
