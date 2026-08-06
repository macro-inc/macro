//! Protocol state and actor shell for one agent-runtime connection.

pub(crate) mod actors;
// The file layout (session/session.rs) is a deliberate organizational
// choice: logic in `session`, vocabulary in `types`.
#[allow(clippy::module_inception)]
mod session;
mod types;

#[cfg(test)]
mod tests;

pub use session::SessionMachine;
pub use types::{CloseReason, Effect, Input, RuntimeStatus, StopReason};
