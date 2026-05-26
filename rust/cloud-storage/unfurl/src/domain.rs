//! Domain layer for the unfurl crate.

pub mod favicon;
pub mod models;
pub mod url_parsers;

#[cfg(feature = "ports")]
pub mod ports;
#[cfg(feature = "ports")]
pub mod service;
