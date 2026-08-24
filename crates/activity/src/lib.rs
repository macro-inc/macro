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
//! consumer); both on by default. The models are always available.

pub mod domain;
#[cfg(any(feature = "ai_tools", feature = "consumer"))]
pub mod inbound;
#[cfg(feature = "outbound")]
pub mod outbound;

pub use domain::models::{
    Action, ActionDecodeError, Activity, ActivityRecord, ActivitySource, Actor, Attribution,
    CallStart, CommonAction, DomainActivity, EntityType, Ingest, ParticipantChange, PropertyChange,
    RecordedAction, VIEW_ACTION_TAGS, activity_id, event_time,
};
pub use domain::overview::{
    ActivityOverview, ActivityOverviewError, ActivityWindow, ActivityWindowError, DayCount,
    EntityRank, MAX_ACTIVITY_WINDOW_DAYS, TOP_ENTITY_LIMIT, trailing_year,
};
pub use domain::ports::{ActivityFeedPage, ActivityRange, ActivityReads, EntityActivityMap};
#[cfg(feature = "ai_tools")]
pub use domain::{
    ports::{ActivityMetadataResolver, ActivityPropertyMetadata},
    service::{ActivityReadService, NoopActivityMetadataResolver, ResolvedActivityRange},
};
