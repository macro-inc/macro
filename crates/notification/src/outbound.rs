//! Outbound adapters for external services.
//!
//! These modules contain implementations of the domain ports that connect
//! to external services like Redis, PostgreSQL, WebSocket gateways, etc.

pub mod device_registration;
pub mod digest_batcher;
pub mod email;
/// WebSocket notification fanout across multiple delivery adapters.
pub mod fanout_websocket;
/// Kafka-backed WebSocket notification delivery.
pub mod kafka_websocket;
pub mod last_online_checker;
pub mod message_receipt_repository;
pub mod mobile;
/// Independent Kafka consumer for WebSocket notification delivery requests.
pub mod notification_consumer;
/// Postgres LISTEN adapter for notification database events.
pub mod notification_events;
pub mod push_notification_checker;
pub mod push_notification_event_queue;
pub mod queue;
pub mod rate_limit;
pub mod repository;
pub mod sns_endpoint;
pub mod user_existence_checker;
pub mod websocket;
