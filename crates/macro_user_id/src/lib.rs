#![deny(missing_docs)]
//! This module provides a parsing utility for validating macro user ids.
//! This follows the newtype pattern and parse don't validate, where possible

pub(crate) mod byte_range;
pub mod email;
pub mod error;
pub mod lowercased;
pub mod user_id;

pub use cowlike;

#[doc(hidden)]
pub const CI_SEL2_NONCE: &str = "458de08bcc24430480e8dbeb5e8f8304";
