#![deny(missing_docs)]

//! Watching and driving an agent teammate's computer screen: single-use
//! socket tickets, the one driver lease per computer, the audit rows, and
//! the hold that keeps the agent's brain waiting while a person drives.
//!
//! The socket, the guest tunnel and the media relays live in
//! `agent_harness_service::computers::screen`.

pub mod domain;
pub mod outbound;
