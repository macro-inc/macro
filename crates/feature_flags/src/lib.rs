#![deny(missing_docs)]
#![doc = include_str!("../README.md")]

pub mod domain;
pub mod outbound;
pub mod polling;

pub use domain::{FeatureFlags, FlagSnapshot, FlagValue, ServiceContext, ServiceFeatureFlags};
