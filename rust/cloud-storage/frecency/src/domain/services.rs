//! This module defines the services that are exposed by this crate

use crate::{
    domain::{
        models::{
            AggregateFrecency, AggregateId, EventAggregationStats, EventRecordWithId,
            FrecencyByIdsRequest, FrecencyPageRequest, FrecencyPageResponse,
        },
        ports::{
            AggregateFrecencyStorage, EventIngestorService, EventRecordStorage, FrecencyQueryErr,
            FrecencyQueryService, PullEventAggregatorService, TimeGetter, UnprocessedEventsRepo,
        },
    },
    outbound::time::DefaultTime,
};
use chrono::{DateTime, Utc};
use macro_user_id::cowlike::CowLike;
use std::{collections::HashMap, sync::Arc};
use tokio::task::JoinHandle;

/// concrete struct which implements [EventIngestorService]
#[derive(Clone)]
pub struct EventIngestorImpl<S> {
    event_storage: S,
}

impl<S> EventIngestorImpl<S>
where
    S: EventRecordStorage,
    anyhow::Error: From<S::Err>,
{
    /// create a new instance of this service
    pub fn new(s: S) -> Self {
        EventIngestorImpl { event_storage: s }
    }
}

impl<S> EventIngestorService for EventIngestorImpl<S>
where
    S: EventRecordStorage,
    anyhow::Error: From<S::Err>,
{
    #[tracing::instrument(err(Debug), skip(self))]
    async fn track_event(
        &self,
        event: super::models::EventRecord<'_>,
    ) -> Result<(), anyhow::Error> {
        self.event_storage
            .set_event(event)
            .await
            .map_err(anyhow::Error::from)
    }
}

/// the message that the [SyncWorker] receives which contains the data to be processed
struct AggregationTask<T> {
    tx: tokio::sync::oneshot::Sender<AggregationOutput<T>>,
    events: Vec<EventRecordWithId<'static, T>>,
    aggregates: Vec<AggregateFrecency>,
    now: DateTime<Utc>,
}

/// completed aggregation which is sent back out of the [SyncWorker]
struct AggregationOutput<T> {
    events: Vec<EventRecordWithId<'static, T>>,
    aggregates: Vec<AggregateFrecency>,
    existing_aggregate_count: usize,
    new_aggregate_count: usize,
}

/// worker which processes the cpu-bound task of computing the aggregate scores
struct SyncWorker<T> {
    #[expect(dead_code)]
    handle: JoinHandle<()>,
    sender: tokio::sync::mpsc::Sender<AggregationTask<T>>,
}

impl<T> SyncWorker<T>
where
    T: Send + 'static,
{
    async fn process_message(
        &self,
        events: Vec<EventRecordWithId<'static, T>>,
        aggregates: Vec<AggregateFrecency>,
        now: DateTime<Utc>,
    ) -> Result<
        tokio::sync::oneshot::Receiver<AggregationOutput<T>>,
        tokio::sync::mpsc::error::SendError<AggregationTask<T>>,
    > {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let task = AggregationTask {
            tx,
            events,
            aggregates,
            now,
        };
        self.sender.send(task).await?;
        Ok(rx)
    }

    fn new() -> Self {
        let (tx, mut rx) = tokio::sync::mpsc::channel(10);
        let handle = tokio::task::spawn_blocking(move || {
            while let Some(AggregationTask {
                tx,
                events,
                aggregates,
                now,
            }) = rx.blocking_recv()
            {
                let mut aggregates: HashMap<_, _> = aggregates
                    .into_iter()
                    .map(|aggregate| (aggregate.id.clone(), aggregate))
                    .collect();

                let existing_aggregate_count = aggregates.len();
                let mut new_aggregate_count = 0usize;
                for e in events.iter() {
                    let Ok(id) = AggregateId::from_event_record(e) else {
                        continue;
                    };
                    aggregates
                        .entry(id.clone())
                        .and_modify(|aggregate| aggregate.append_event_mut(&e.event_record, now))
                        .or_insert_with(|| {
                            new_aggregate_count += 1;
                            AggregateFrecency::new_from_initial_action_and_user_id(
                                id.user_id.into_owned(),
                                e.event_record.clone(),
                                now,
                            )
                        });
                }

                let aggregates = aggregates.into_values().collect();
                let _ = tx.send(AggregationOutput {
                    events,
                    aggregates,
                    existing_aggregate_count,
                    new_aggregate_count,
                });
            }
        });

        SyncWorker { handle, sender: tx }
    }
}

/// a concrete struct which implements [PullEventAggregatorService]
#[derive(Clone)]
pub struct PullAggregatorImpl<S: UnprocessedEventsRepo, T> {
    event_storage: S,
    time: T,
    sync_worker: Arc<SyncWorker<S::EventId>>,
}

impl<S, T> PullAggregatorImpl<S, T>
where
    S: UnprocessedEventsRepo,
    anyhow::Error: From<S::Err>,
    T: TimeGetter,
{
    /// create a new instance of self
    pub fn new(event_storage: S, time: T) -> Self {
        PullAggregatorImpl {
            event_storage,
            time,
            sync_worker: Arc::new(SyncWorker::new()),
        }
    }
}

impl<S> PullAggregatorImpl<S, DefaultTime>
where
    S: UnprocessedEventsRepo,
    anyhow::Error: From<S::Err>,
{
    /// create an instance of self passing the default impl for [TimeGetter]
    pub fn new_with_default_time(event_storage: S) -> Self {
        Self::new(event_storage, DefaultTime)
    }
}

impl<S, T> PullEventAggregatorService for PullAggregatorImpl<S, T>
where
    S: UnprocessedEventsRepo,
    anyhow::Error: From<S::Err>,
    T: TimeGetter,
{
    #[tracing::instrument(err, skip(self))]
    async fn append_events_to_aggregate(&self) -> Result<EventAggregationStats, anyhow::Error> {
        let events: Vec<_> = self.event_storage.get_unprocessed_events().await?;

        let event_count = events.len();

        let ids: Result<Vec<_>, _> = events.iter().map(AggregateId::from_event_record).collect();
        let ids = ids?;

        let aggregates = self
            .event_storage
            .get_aggregates_for_users_entities(ids)
            .await?;

        let rx = self
            .sync_worker
            .process_message(events, aggregates, self.time.now())
            .await
            .map_err(|r| anyhow::anyhow!("Tried to send message to closed worker: {r:?}"))?;

        let AggregationOutput {
            events,
            aggregates,
            existing_aggregate_count,
            new_aggregate_count,
        } = rx.await?;

        self.event_storage.set_aggregates(aggregates).await?;

        self.event_storage.mark_processed(events).await?;

        Ok(EventAggregationStats {
            event_count,
            existing_aggregate_count,
            new_aggregate_count,
        })
    }
}

/// concrete struct which implements [FrecencyQueryService]
#[derive(Clone)]
pub struct FrecencyQueryServiceImpl<T> {
    storage: T,
}

impl<T> FrecencyQueryServiceImpl<T>
where
    T: AggregateFrecencyStorage,
    anyhow::Error: From<T::Err>,
{
    /// create a new instance of Self
    pub fn new(storage: T) -> Self {
        FrecencyQueryServiceImpl { storage }
    }
}

impl<T> FrecencyQueryService for FrecencyQueryServiceImpl<T>
where
    T: AggregateFrecencyStorage,
    anyhow::Error: From<T::Err>,
{
    async fn get_frecency_page(
        &self,
        query: FrecencyPageRequest<'_>,
    ) -> Result<FrecencyPageResponse, FrecencyQueryErr> {
        let res = self
            .storage
            .get_top_entities(query)
            .await
            .map_err(anyhow::Error::from)?;
        Ok(FrecencyPageResponse::new(res))
    }

    async fn get_frecencies_by_ids<'a>(
        &self,
        request: FrecencyByIdsRequest<'a>,
    ) -> Result<FrecencyPageResponse, FrecencyQueryErr> {
        let FrecencyByIdsRequest { user_id, ids } = request;
        let res = self
            .storage
            .get_aggregate_for_user_entities(user_id, ids)
            .await
            .map_err(anyhow::Error::from)?;
        Ok(FrecencyPageResponse::new(res))
    }
}
