#![deny(missing_docs)]
//! Attribution of work to its originating code-mode invocation (agent
//! session) and to the routine run it acts for.
//!
//! This context grants no access. HTTP validates the signed claim once, before
//! application work; durable events retain the accepted ID independently of the
//! lifetime of the originating request or session.
//!
//! The task-local context itself lives in `agent_attribution`, re-exported
//! here as `context`, `scope` and `verb`.

pub use agent_attribution::{AgentVerb, context, scope, verb};
pub mod domain;
#[cfg(feature = "http")]
pub mod inbound;
#[cfg(feature = "postgres")]
pub mod outbound;
