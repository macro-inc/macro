//! Compatibility re-exports for the agent trigger router.
//!
//! The broker consumer is owned by the service binary. Routing and beta-gate
//! policy live in the domain; this module remains so existing callers do not
//! need to change import paths atomically.

pub use crate::domain::trigger_router::{
    RoutedTrigger, Skipped, agent_trigger_bot_id, route_agent_trigger,
};

#[cfg(test)]
mod test;
