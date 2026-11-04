//! External agents: agent personas whose runtime lives outside Macro.
//!
//! An external agent is an ordinary agent (a bot with an agent
//! configuration) on the [`harness_id::EXTERNAL_HARNESS_SLUG`] harness, so
//! people DM it and mention it like any agent, and the agent trigger decides
//! when a message addresses it. Nothing in Macro runs it. Instead:
//!
//! - every message that addressed it becomes one event in its inbox
//!   ([`domain::inbox`]), pushed to its webhook endpoint when it registered
//!   one and readable by polling either way;
//! - its runtime reads the inbox, replies to an event, and shows itself
//!   typing through [`domain::api`], authenticated by its bot token;
//! - its owner registers and manages it through [`domain::registry`].
//!
//! # Architecture
//!
//! - **domain**: the registry, inbox, and agent API over narrow ports.
//! - **inbound**: the agent-trigger Kafka consumer feeding the inbox.
//! - **outbound**: Postgres storage and the adapters onto the bots, webhook,
//!   and entity access domains.

#![deny(missing_docs)]

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;
