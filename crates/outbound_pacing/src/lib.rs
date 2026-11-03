#![deny(missing_docs)]
//! Pacing for calls Macro makes to a rate-limited provider, keyed by an
//! opaque caller-chosen key (such as a hash of the credential).
//!
//! [`Pacer`] spaces calls per key, remembers when the provider said a key
//! may call again, holds a call briefly when its turn or that time is close,
//! and otherwise fails at once with when to retry. [`SingleFlight`] shares
//! one run of identical work among callers waiting on it together.
//!
//! The crate knows nothing about any provider: callers read the provider's
//! answer and report it as an [`Answer`].

mod pacer;
mod single_flight;

pub use pacer::{Answer, PaceError, Pacer, PacingConfig, Throttled};
pub use single_flight::SingleFlight;
