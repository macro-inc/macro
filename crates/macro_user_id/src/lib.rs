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
pub const CI_INTEGRATE_NONCE: &str = "c4abe37f3f674676a8a7bb6127ae6c0e";
