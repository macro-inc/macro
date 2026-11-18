//! Agent permissions: for each agent, which Macro SDK operations its code may
//! call always, only after a person approves, or never.
//!
//! Settings are stored per group and action (`documents` × `destroy`) and,
//! where a person or the agent diverged from the group, per operation. An
//! agent may only tighten its own settings; loosening and reset need a
//! person's own session. The operations, their groups and actions come from
//! `agent_permission_registry`.

#![deny(missing_docs)]

pub mod domain;
pub mod inbound;
pub mod outbound;
