//! Outbound adapters: the concrete providers, stores, and carriers the domain
//! ports are satisfied by.

pub mod agent_prompt_composer;
pub mod channel_announcer;
pub mod channel_prompt_context;
pub mod containers;
pub mod cursor;
pub mod daytona;
pub mod egress;
pub mod local;
pub(crate) mod managed_containers;
pub mod namespace;
pub(crate) mod provision;
pub mod routing;
pub mod runtime_registry;
pub mod sidecar;
