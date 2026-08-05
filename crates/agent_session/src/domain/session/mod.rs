//! One session connection: a pure protocol state machine and the actor
//! shell that drives it.
//!
//! Scope: ONE connection of a session to an agent runtime. Ephemeral by
//! design - every attach builds a fresh machine, and nothing in here survives
//! a reconnect. The durable session is its `agent_session` row; the durable
//! history is its log stream. The machine holds only the session's *identity*,
//! never a snapshot of the row.
//!
//! Sans-IO: [`SessionMachine::handle`] consumes one [`Input`] and returns the
//! ordered [`Effect`]s it implies. Nothing in the machine is async, performs
//! IO, or knows what a transport or a log repository is - the imperative
//! shell in [`actors`] executes effects in order and feeds failures back in
//! as [`Input::Closed`]. That inversion is what makes delivery accounting
//! trivial: an [`Effect::Complete`] is emitted immediately after the
//! [`Effect::Send`] that satisfies it, so "delivered" is positional rather
//! than counted.
//!
//! `Token` identifies a caller awaiting delivery. The machine never inspects
//! it - the actor uses oneshot senders, tests use integers.

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
