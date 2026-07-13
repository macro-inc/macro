//! This module defines concrete implementations of the required outbound ports
//! Outbounds ports are things in the outside world that we reach out to

#[cfg(feature = "postgres")]
pub mod postgres;

#[cfg(feature = "mock")]
pub mod mock;

pub mod time;
