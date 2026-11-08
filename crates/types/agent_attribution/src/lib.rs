#![deny(missing_docs)]
//! What the current work is attributed to, carried in task-local context: the
//! code-mode invocation (agent session), the routine run it acts for, the
//! session's scope and the SDK display verb.
//!
//! The context grants no access. `agent_correlation` validates a signed claim
//! at the HTTP boundary and sets it here; leaf crates such as
//! `permissions_types` read it without depending on that adapter.

pub mod context;
pub mod scope;
pub mod verb;
pub use verb::AgentVerb;
