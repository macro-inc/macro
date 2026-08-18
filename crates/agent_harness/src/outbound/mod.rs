//! Outbound adapters: the concrete providers, stores, and carriers the domain
//! ports are satisfied by.

pub mod channel_announcer;
pub mod containers;
pub mod daytona;
pub mod local;
pub(crate) mod managed_containers;
pub mod namespace;
pub mod persona_config;
pub(crate) mod provision;
pub mod runtime_registry;
pub(crate) mod session_env;
pub mod sidecar;
