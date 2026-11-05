#![deny(missing_docs)]
//! Agent secrets: values a team agent keeps for itself (third-party tokens
//! and the like), KMS-encrypted per agent and name, fetched per use.
//!
//! Never in prompts, files or the computer's config drive; the brain reads a
//! secret through `GET /team_agents/me/secrets/{name}` when it needs one.
//!
//! - **domain**: models, ports, and the service (who may read what).
//! - **inbound**: the Axum router (feature `inbound`).
//! - **outbound**: Postgres rows and the KMS cipher (feature `outbound`).

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
