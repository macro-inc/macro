#![deny(missing_docs)]
//! This crate defines the api interface of frecency calculation following the
//! hexagonal architecture pattern

pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;
