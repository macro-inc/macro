//! Outbound adapters for external services.
//!
//! These modules contain implementations of the domain ports that connect
//! to external services like Redis, PostgreSQL, WebSocket gateways, etc.

pub mod device_registration;
pub mod digest_batcher;
pub mod email;
pub mod last_online_checker;
pub mod message_receipt_repository;
pub mod mobile;
pub mod push_notification_checker;
pub mod push_notification_event_queue;
pub mod queue;
pub mod rate_limit;
pub mod repository;
pub mod sns_endpoint;
pub mod user_existence_checker;
pub mod websocket;
