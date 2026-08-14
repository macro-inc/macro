#![deny(missing_docs)]
//! Sans-IO state machines replacing the sync-service Durable Object.
//!
//! Nothing in this crate performs IO, reads a clock, or spawns a task. The
//! [`machine::DocMachine`] models one document; the [`manager::ConnManager`]
//! owns many machines and routes connection-scoped events to them. Both are
//! driven the same way: feed an input, collect the emitted effects. The
//! runtime (persistence, sockets, timers) lives elsewhere and is expected to
//! execute effects and feed their completions back as inputs.
//!
//! First pass: everything IO-shaped is mocked in tests; the only [`Replica`]
//! implementation is [`replica::mock::MockReplica`]. A Loro-backed replica and
//! the tokio/Postgres runtime come later and must not change these types.
//!
//! [`Replica`]: replica::Replica

pub mod machine;
pub mod manager;
pub mod model;
pub mod replica;
