#![deny(missing_docs)]
//! Agent teammates: AI members of a team, each a real Macro account with its
//! own Macro computer and workspace repository.
//!
//! Inviting one creates its account (no sign-in), joins it to the team with
//! an included seat, creates its workspace repository, and buys its computer
//! through the normal per-computer purchase. The computer's enrollment
//! carries the agent's fresh credentials to the brain in its image.
//!
//! # Architecture
//!
//! - **domain**: models, ports, and the service.
//! - **inbound**: the Axum router (feature `inbound`).
//! - **outbound**: Postgres, teams, API key, repository and computer adapters
//!   (feature `outbound`).

pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;
