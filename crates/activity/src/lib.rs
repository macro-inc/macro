#![deny(missing_docs)]
//! The activity protocol and its storage/consumer machinery.
//!
//! One activity: a principal did something to an entity at a time. Every
//! activity surface (feeds, entity timelines, soup attribution sorts) is a
//! query over the single `activity_events` table; there are no derived
//! tables.
//!
//! Ownership boundary: this crate owns **what an activity is** — the
//! durable [`Action`](domain::models::Action) vocabulary, the
//! [`Activity`](domain::models::Activity) row shape, and the
//! [`DomainActivity`](domain::models::DomainActivity) contract. Domain
//! crates own **what counts as activity in their domain**: they depend on
//! this crate with `default-features = false` (models only) and implement
//! their own event → activity mappings. The hosting service is the
//! composition root: it declares the consumed topics and dispatches each
//! decoded event to the owning domain's mapping.
//!
//! Features: `outbound` (Postgres adapter), `consumer` (generic Kafka
//! consumer and realtime Kafka adapters), `realtime` (user-scoped realtime
//! distribution); all on by default. The models and wire events are always
//! available.

pub mod domain;
#[cfg(feature = "consumer")]
pub mod inbound;
#[cfg(any(feature = "outbound", feature = "consumer"))]
pub mod outbound;

pub use domain::events::{ActivityMacroEvent, ActivityTopicEvent, ActivityWireRow};
pub use domain::models::{
    Action, ActionDecodeError, Activity, ActivityRecord, ActivitySource, Actor, CallStart,
    CommonAction, DomainActivity, EntityType, Ingest, ParticipantChange, PropertyChange,
    RecordedAction, VIEW_ACTION_TAGS, activity_id, event_time,
};
pub use domain::ports::{
    ActivityAudienceExpander, ActivityFeedPage, ActivityReads, ActivityRealtimePublisher,
    EntityActivityMap, NoOpActivityAudienceExpander, NoOpActivityRealtimePublisher,
};
#[cfg(feature = "realtime")]
pub use domain::realtime::{
    ActivityRealtimeConsumerService, ActivitySubscription, ActivitySubscriptionExit,
    ActivitySubscriptionService, ActivitySubscriptionUpdate, ActivityTopicEventConsumer,
    NoOpActivitySubscriptionService,
};
#[cfg(all(feature = "consumer", feature = "realtime"))]
pub use outbound::activity_topic_consumer::ActivityTopicConsumer;
#[cfg(feature = "consumer")]
pub use outbound::kafka_activity_realtime::KafkaActivityRealtimePublisher;
