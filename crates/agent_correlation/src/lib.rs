#![deny(missing_docs)]
//! Attribution of code-mode work to its originating agent session.
//!
//! This context grants no access. HTTP validates the signed claim once, before
//! application work; durable events retain the accepted ID independently of the
//! lifetime of the originating request or session.

pub mod context;
pub mod domain;
#[cfg(feature = "http")]
pub mod inbound;
#[cfg(feature = "postgres")]
pub mod outbound;
