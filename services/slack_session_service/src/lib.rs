//! Slack session service: runs the Slack sessions this replica holds
//! advisory locks for, and the sign-ins DSS records. See `AGENTS.md`.

pub mod config;
pub mod domain;
pub mod inbound;
pub mod outbound;
pub mod replica;
