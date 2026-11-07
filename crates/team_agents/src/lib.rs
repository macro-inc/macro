#![deny(missing_docs)]
//! Team agents: AI teammates that are real Macro accounts on a team, each on
//! its own Macro computer.
//!
//! Inviting one creates a verified account (no sign-in), its inbox, team
//! membership and workspace repo, then buys its computer with the
//! seat in the same Stripe update. Bootstrap credentials are issued only at enrollment.
//!
//! # Architecture
//!
//! - **domain**: models, ports, and the service.
//! - **inbound**: the Axum router (feature `inbound`).
//! - **outbound**: Postgres, Dead Simple Email, teams, API key, computers and
//!   repo adapters (feature `outbound`).

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
