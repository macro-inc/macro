//! Outbound adapters implementing the Jev ports.

pub mod typesafe;

pub use typesafe::{TypesafeApiKey, TypesafeConfigError, TypesafeJev};
