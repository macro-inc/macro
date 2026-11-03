#![deny(missing_docs)]
//! Team agents: AI teammates that are real Macro accounts on a team.
//!
//! Creating one makes a verified account (no sign-in), adds it to the team,
//! gives it an email inbox and an API key, and starts its brain: a coding
//! agent on a team macrod runtime that builds itself a daemon from the
//! `agent_brain` crate.
//!
//! # Architecture
//!
//! - **domain**: models, ports, and the service.
//! - **inbound**: the Axum router (feature `inbound`).
//! - **outbound**: Postgres, AgentMail, and Macro API adapters (feature
//!   `outbound`).

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
