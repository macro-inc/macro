#![deny(missing_docs)]
//! Shared, owner-attributed AI capabilities backed by the cognition service.
//!
//! Normal Macro tools and code-mode SDK calls use the same port. The remote
//! service owns model access, admission, provider credentials, and usage metering.

pub mod domain;
pub mod inbound;
pub mod outbound;
