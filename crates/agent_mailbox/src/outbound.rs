//! Adapters for the agent mailbox ports.

pub mod deadsimple;
#[cfg(feature = "fake-vendor")]
pub mod fake_vendor;
pub mod kms;
pub mod pg;
