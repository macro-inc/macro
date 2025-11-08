//! This module defines all of the ports that the frecency domain requires

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use thiserror::Error;

use crate::domain::models::{
    AggregateFrecency, AggregateId, EventAggregationStats, EventRecord, EventRecordWithId,
    FrecencyPageRequest, FrecencyPageResponse,
};

/// Trait for interacting with the storage of [EventRecord] records
pub trait EventRecordStorage: Send + Sync + 'static {
    /// The error type that can occur
    type Err: Send;
    /// write a new [EventRecord] into storage
    fn set_event(&self, record: EventRecord) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// trait for getting the events which have not yet been aggregated
pub trait UnprocessedEventsRepo: Send + Sync + 'static {
    /// the error type that can occur
    type Err: Send;
    /// The type used to identify events
    type EventId: Send;

    /// get the events which have not yet been aggregated
    fn get_unprocessed_events(
        &self,
    ) -> impl Future<Output = Result<Vec<EventRecordWithId<'static, Self::EventId>>, Self::Err>> + Send;

    /// mark the input event as processed such that it will not be retrieved as part of the [UnprocessedEventsRepo::get_unprocessed_events]
    fn mark_processed<'a>(
        &self,
        event: Vec<EventRecordWithId<'a, Self::EventId>>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// fetches the records for the input [AggregateId] s
    fn get_aggregates_for_users_entities(
        &self,
        agregates: Vec<AggregateId<'_>>,
    ) -> impl Future<Output = Result<Vec<AggregateFrecency>, Self::Err>> + Send;

    /// writes multiple aggregate records
    fn set_aggregates(
        &self,
        aggregates: Vec<AggregateFrecency>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// trait for interacting with the storage of [AggregateFrecency] records
pub trait AggregateFrecencyStorage: Send + Sync + 'static {
    /// the error type that can occur
    type Err: Send;

    /// retrieve the top frecency score records for this user
    fn get_top_entities(
        &self,
        user_id: MacroUserIdStr<'_>,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<AggregateFrecency>, Self::Err>> + Send;

    /// write an [AggregateFrecency] back to storage
    fn set_aggregate(
        &self,
        frecency: AggregateFrecency,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// retrieve the specific aggregate record for this entity + user pair
    fn get_aggregate_for_user_entity_pair(
        &self,
        user_id: MacroUserIdStr<'_>,
        entity: Entity<'_>,
    ) -> impl Future<Output = Result<Option<AggregateFrecency>, Self::Err>> + Send;

    /// retrieve the specific aggregate record for the input entities + user pair
    fn get_aggregate_for_user_entities<T>(
        &self,
        user_id: MacroUserIdStr<'static>,
        entities: T,
    ) -> impl Future<Output = Result<Vec<AggregateFrecency>, Self::Err>>
    where
        T: Iterator<Item = Entity<'static>>;
}

/// port for getting the current system time
/// This is useful because the system time is always changing in the real world.
/// Having a trait allows tests to be consistent
pub trait TimeGetter: Send + Sync + 'static {
    /// get the current system time
    fn now(&self) -> DateTime<Utc>;
}

/// trait that defines the api interface for sending events into the frecency aggregation pipeline
pub trait EventIngestorService: Send + Sync + 'static {
    /// send the input event to the frecency aggregation pipeline
    fn track_event(
        &self,
        event: EventRecord,
    ) -> impl Future<Output = Result<(), anyhow::Error>> + Send;
}

/// trait which defines the interface for a push aggregator service.
/// This is used to compute frecency scores in the background.
/// A push service receives single events as they are created
pub trait PushEventAggregatorService: Send + Sync + 'static {
    /// given some input [EventRecord] update the [AggregateFrecency] for said record
    fn append_event_to_aggregate(
        &self,
        event: EventRecord,
    ) -> impl Future<Output = Result<(), anyhow::Error>> + Send;
}

/// trait which defines the interface For a pull aggregator service.
/// This is used to compute frecency scores in the background.
/// A pull service receives batches of events at certain intervals
pub trait PullEventAggregatorService: Send + Sync + 'static {
    /// read the events that need processing, and then write the aggregate values to the db
    fn append_events_to_aggregate(
        &self,
    ) -> impl Future<Output = Result<EventAggregationStats, anyhow::Error>> + Send + '_;
}

/// The error that is produced by the [FrecencyQueryService]
#[derive(Debug, Error)]
#[error(transparent)]
pub struct FrecencyQueryErr(#[from] anyhow::Error);

/// The service level interface for querying frecency data
#[cfg_attr(feature = "mock", mockall::automock)]
pub trait FrecencyQueryService: Send + Sync + 'static {
    /// get the [FrecencyPageResponse] for the input [FrecencyPageRequest]
    fn get_frecency_page<'a>(
        &self,
        query: FrecencyPageRequest<'a>,
    ) -> impl Future<Output = Result<FrecencyPageResponse, FrecencyQueryErr>> + Send;
}
