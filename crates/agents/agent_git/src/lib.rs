#![deny(missing_docs)]
//! Agent workspace repos: exactly one bare git repo per agent user, served
//! over smart HTTP behind Macro auth.
//!
//! - **domain**: models, ports and [`domain::service::AgentGitServiceImpl`],
//!   which owns every access decision (repo token, team admin, size cap,
//!   push rate).
//! - **inbound** (`inbound`): the internal create/delete API and the public
//!   smart-HTTP router.
//! - **outbound** (`outbound`): Postgres rows, bare repos on a directory,
//!   `git http-backend`, team roles, and the in-memory push limiter.
//! - **client** (`client`): the HTTP client other services use to create and
//!   delete repos.

pub mod api;
#[cfg(feature = "client")]
pub mod client;
pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;
