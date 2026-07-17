#![deny(missing_docs)]
//! Event broker that publishes events to Kafka via a ports-and-adapters design.
//!
//! The [`domain`] layer defines typed event envelopes, per-topic
//! [`TopicEvent`](domain::models::TopicEvent) enums, the
//! [`MacroEvent`](domain::models::MacroEvent) event abstraction, the inbound
//! [`MacroEventBroker`](domain::ports::MacroEventBroker) API, the outbound
//! [`EventPublisher`](domain::ports::EventPublisher) port, and the
//! [`MacroEventBrokerService`](domain::service::MacroEventBrokerService) that ties
//! them together. Kafka topic definitions live in the `macro_event_topics` crate.
//! The [`outbound`] layer provides the Kafka adapter implementation.

/// Domain layer: models, ports, and service.
pub mod domain;

pub use domain::models::{Event, EventBrokerError, MacroEvent, TopicEvent};
pub use macro_event_topics::{
    MacroChannelsTopic, MacroDocumentsTopic, MacroEmailTopic, MacroExampleTopic,
    MacroProjectsTopic, Topic,
};

#[cfg(feature = "ports")]
pub use domain::ports::{EventPublisher, MacroEventBroker};
#[cfg(feature = "ports")]
pub use domain::service::{MacroEventBrokerService, NoopMacroEventBroker};
#[cfg(feature = "outbound")]
pub use outbound::kafka_event_publisher::KafkaEventPublisher;
#[cfg(feature = "outbound")]
pub use outbound::msk_iam::MskIamClientContext;

/// Outbound layer: Kafka adapter for the [`EventPublisher`](domain::ports::EventPublisher) port.
#[cfg(feature = "outbound")]
pub mod outbound;
