//! Event stream domain: audiences, filters, the catalog, the subscriber
//! registry, fan-out and streams.

/// Audience resolution against current access.
pub mod access;
/// The registry of public event names.
pub mod catalog;
/// Fan-out of log entries to open streams.
pub mod fan_out;
/// Subscriber filters shared with persisted webhooks.
pub mod filters;
/// Access facts an event changes.
pub mod invalidations;
/// Writing the public event log.
pub mod log_writer;
/// Domain models.
pub mod models;
/// A broker event's public form.
pub mod normalize;
/// Ports.
pub mod ports;
/// The open-stream registry and its indexes.
pub mod registry;
/// Opening and running one stream.
pub mod stream;
#[cfg(test)]
pub(crate) mod test_support;
/// Webhook lifecycle events (`macro.webhooks`).
pub mod webhook_lifecycle;
