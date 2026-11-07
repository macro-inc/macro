#![deny(missing_docs)]
//! Paginated channel messages with thread previews, reactions, and attachments.
//!
//! The domain: models, ports and services. The HTTP routes, AI toolset,
//! attachment adapter and Kafka consumers are `channels_inbound`; the
//! Postgres, gateway, notification and static-file adapters are
//! `channels_outbound`.

/// Domain layer: models, ports, and service.
pub mod domain;
/// Conversions into the Soup wire models.
#[cfg(feature = "list")]
pub mod soup;
