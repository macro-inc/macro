#![deny(missing_docs)]
//! Concrete implementations of `frecency_core`'s ports: Postgres storage
//! (feature `postgres`), a mockall storage mock (feature `mock`) and the
//! system clock.

#[cfg(feature = "postgres")]
pub mod postgres;

#[cfg(feature = "mock")]
pub mod mock;

pub mod time;
