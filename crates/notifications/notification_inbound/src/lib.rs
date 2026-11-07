//! The inbound adapters for `notification`: the HTTP routes (feature
//! `axum`), the AI tool (`ai_tool`), and the ingress, event and push workers.

#![deny(missing_docs)]

#[cfg(feature = "ai_tool")]
pub mod ai_tool;
#[cfg(feature = "axum")]
pub mod http;
/// Worker for processing notification requests from the ingress queue.
pub mod ingress_worker;
/// Listener for notification database events emitted via Postgres NOTIFY.
pub mod notification_events_listener;
/// Worker for processing push notification delivery events.
pub mod push_notification_event_worker;
/// Worker for delivering notifications from the delivery queue.
pub mod worker;
