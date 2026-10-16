//! Yes/no classification of arbitrary JSON input with TypeSafe's Jev model.
//!
//! Hexagonal layout: [`domain`] owns the question and probability value
//! objects, the provider port, and the metered classification use case;
//! [`outbound`] implements the port against the TypeSafe API.
#![deny(missing_docs)]

pub mod domain;
#[cfg(feature = "outbound")]
pub mod outbound;
