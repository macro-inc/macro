#![deny(missing_docs)]
//! Event broker that publishes events to Kafka via a ports-and-adapters design.
//!
//! The [`domain`] layer defines typed event envelopes, per-topic
//! [`TopicEvent`](domain::models::TopicEvent) enums, the
//! [`MacroEvent`](domain::models::MacroEvent) event abstraction, the inbound
//! [`MacroEventBroker`](domain::ports::MacroEventBroker) API, the outbound
//! [`EventPublisher`](domain::ports::EventPublisher) port, the producing
//! [`MacroEventBrokerService`](domain::service::MacroEventBrokerService), and the
//! typed [`MacroEventConsumerService`](domain::service::MacroEventConsumerService),
//! which receives messages through the [`EventConsumer`](domain::ports::EventConsumer) port.
//! Kafka topic definitions live in the `macro_event_topics` crate. Shared Kafka
//! producer and consumer transports live in `kafka_util`, while the [`outbound`]
//! layer adapts its producer to [`EventPublisher`](domain::ports::EventPublisher).

/// Domain layer: models, ports, and service.
pub mod domain;

pub use domain::models::{Event, EventBrokerError, MacroEvent, MessageWrapper, TopicEvent};
pub use macro_event_topics::{
    MacroChannelsTopic, MacroDocumentsTopic, MacroEmailTopic, MacroExampleTopic,
    MacroProjectsTopic, Topic,
};

pub use domain::ports::{
    EventConsumer, EventPublisher, MacroEventBroker, MacroEventCollection, MessageParts,
};
pub use domain::service::{
    MacroEventBrokerService, MacroEventConsumerService, NoopMacroEventBroker,
};
#[cfg(feature = "outbound")]
pub use outbound::{
    kafka_event_consumer::KafkaConsumerAdapter, kafka_event_publisher::KafkaEventPublisher,
};

/// Outbound adapters for the macro event broker's required ports.
#[cfg(feature = "outbound")]
pub mod outbound;
