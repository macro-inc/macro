#![deny(missing_docs)]
//! Attribution of work to its originating code-mode invocation (agent
//! session) and to the routine run it acts for.
//!
//! This context grants no access. HTTP validates the signed claim once, before
//! application work; durable events retain the accepted ID independently of the
//! lifetime of the originating request or session.

pub mod context;
pub mod domain;
pub mod verb;
pub use verb::AgentVerb;
#[cfg(feature = "http")]
pub mod inbound;
#[cfg(feature = "postgres")]
pub mod outbound;
