//! OpenBao's mounted API generated from pinned local 2.7.2 specifications.
//!
//! The wrapper keeps credential values and provider messages out of ordinary
//! error formatting. Namespace selection and lifecycle policy belong to callers.
#![deny(missing_docs)]

mod client;
mod error;
mod secret;

/// Generated wire API. Keep request and response values inside this crate.
mod generated;

pub use client::{KvMetadata, KvVersion, OpenBaoClient, Session};
pub use error::{Cause, Error};
pub use secret::SecretString;
