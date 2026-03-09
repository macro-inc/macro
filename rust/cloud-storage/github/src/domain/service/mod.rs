//! Github service implementation.

#[cfg(feature = "sync")]
mod sync;

#[cfg(feature = "sync")]
pub use sync::*;

#[cfg(feature = "link")]
mod link;

#[cfg(feature = "link")]
pub use link::*;
