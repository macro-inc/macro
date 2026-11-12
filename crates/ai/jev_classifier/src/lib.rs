//! Yes/no classification of arbitrary JSON input with TypeSafe's Jev model.
//!
//! Hexagonal layout: [`domain`] owns the question and probability value
//! objects, the provider port, and the metered classification use case;
//! [`outbound`] implements the port against the TypeSafe API.
//!
//! The `decisions` feature adds the general named-decision use case: validated
//! [`domain::DecisionRequest`] inputs, trusted-user AI admission, bounded
//! concurrency and deadlines, and the existing classifier's usage recording.
//! Request/response types and request validation remain available without it.
#![deny(missing_docs)]

pub mod domain;
#[cfg(feature = "outbound")]
pub mod outbound;
