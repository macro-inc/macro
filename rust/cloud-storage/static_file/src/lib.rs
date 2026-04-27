//! Hex crate for static file resolution.
#![deny(missing_docs)]

pub mod domain;

#[cfg(feature = "attachment")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
