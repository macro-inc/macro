//! Port definitions for the github domain.
//!
//! These traits define the contracts that adapters must implement.

#[cfg(feature = "link")]
mod link;
#[cfg(feature = "sync")]
mod sync;

#[cfg(feature = "link")]
pub use link::*;
#[cfg(feature = "sync")]
pub use sync::*;
