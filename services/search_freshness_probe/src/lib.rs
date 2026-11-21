//! End-to-end search freshness probe: writes a random token into entities the
//! probe user owns, through the public API, and measures how long until
//! search shows it.

pub mod config;
pub mod domain;
pub mod inbound;
pub mod outbound;
