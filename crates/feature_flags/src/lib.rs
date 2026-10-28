#![deny(missing_docs)]
#![doc = include_str!("../README.md")]

pub mod domain;
pub mod outbound;

pub use domain::{FeatureFlags, FlagSnapshot, FlagValue};
