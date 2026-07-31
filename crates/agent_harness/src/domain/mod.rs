//! The center of the hexagon: what a mention-triggered agent run *is*,
//! independent of how the mention reaches us (Kafka), what carries the run's
//! frames (Redis to agent_proxy), or who hands out sandboxes (Daytona).
//!
//! Nothing in here may reach for `rdkafka`, `axum`, `reqwest`, `redis`, or
//! `tokio_tungstenite`, nor for the broker event types in `channels`: those
//! belong to the adapters on either side.

pub mod handler;
pub mod models;
pub mod ports;
pub mod provision;
pub mod runtime;
