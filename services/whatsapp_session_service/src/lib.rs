// The account runner future nests the domain, store and client futures.
#![recursion_limit = "256"]
//! WhatsApp session service: runs the linked WhatsApp accounts this replica
//! holds advisory locks for. See `AGENTS.md`.

pub mod config;
pub mod domain;
pub mod inbound;
pub mod outbound;
pub mod replica;
