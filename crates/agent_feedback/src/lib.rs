#![deny(missing_docs)]
#![doc = include_str!("../README.md")]

pub mod domain;
#[cfg(feature = "inbound")]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;
#[cfg(feature = "inbound")]
pub mod swagger;
#[cfg(test)]
mod test_support;
