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
pub const CI_SEL2_NONCE: &str = "b528981cf35248f9bc6ea91ecfa52a53";
