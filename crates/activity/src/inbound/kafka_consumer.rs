//! Generic Kafka consumer that materializes activities from domain events.
//!
//! This machinery knows **zero domains**: it is generic over a declared
//! event collection `C` and a host-supplied dispatcher `Fn(&C) -> Ingest`.
//! The composition root (the hosting service) declares the topics and maps
//! each decoded event to the owning domain's ingest function.
//!
//! Delivery is at least once. Malformed messages and recognized-but-inert
//! events are committed so they cannot wedge a partition. A storage failure
//! aborts the run **without committing** — committing any later record on
//! the partition would cumulatively commit past the failed one — and the
//! host supervisor restarts the consumer from the last committed offset;
//! deterministic activity ids make the replayed inserts idempotent.

use std::future::Future;
use std::marker::PhantomData;

use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{KafkaConsumerAdapter, MacroEventCollection, MacroEventConsumerService};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use rootcause::prelude::{Report, ResultExt as _};
use tracing::Instrument as _;

use crate::domain::{models::Ingest, ports::ActivityRepo};

/// Consumer group for activity materialization offsets.
struct ActivityConsumerGroup;

impl GroupName for ActivityConsumerGroup {
    const GROUP_NAME: &'static str = "activity-materializer";
}

/// Consumes activity-bearing topics and writes activities through the repo.
///
/// `C` is the host's declared event collection (`declare_topics!`); `ingest`
/// is the host's dispatch from a decoded event to the owning domain's
/// mapping.
pub struct ActivityConsumer<R, C, F> {
    repo: R,
    ingest: F,
    _events: PhantomData<fn() -> C>,
}

impl<R, C, F> ActivityConsumer<R, C, F>
where
    R: ActivityRepo,
    C: MacroEventCollection + 'static,
    F: Fn(&C) -> Ingest + Send + Sync,
{
    /// Builds the consumer over an activity store and an event dispatcher.
    pub fn new(repo: R, ingest: F) -> Self {
        Self {
            repo,
            ingest,
            _events: PhantomData,
        }
    }

    /// Applies one decoded event to storage.
    async fn apply(&self, event: &C) -> Result<(), R::Err> {
        match (self.ingest)(event) {
            Ingest::Insert(activities) => self.repo.insert_activities(&activities).await,
            Ingest::Purge(entities) => self.repo.purge_entities(&entities).await,
            Ingest::Ignore => Ok(()),
        }
    }

    /// Runs the consumer until `shutdown` resolves.
    #[tracing::instrument(skip(self, shutdown), fields(brokers), err)]
    pub async fn run(
        &self,
        brokers: &str,
        shutdown: impl Future<Output = ()> + Send,
    ) -> Result<(), Report> {
        let consumer = KafkaEventConsumer::<ActivityConsumerGroup>::from_env(brokers)?;
        let consumer = KafkaConsumerAdapter::<ActivityConsumerGroup, ()>::new(consumer)
            .subscribe::<C>()
            .context("failed to subscribe to activity topics")?;
        let consumer = MacroEventConsumerService::<C, _>::new(consumer);
        tracing::info!(
            topics = ?C::topics(),
            group = ActivityConsumerGroup::GROUP_NAME,
            "activity consumer listening"
        );

        let mut shutdown = std::pin::pin!(shutdown);
        loop {
            tokio::select! {
                _ = &mut shutdown => {
                    tracing::info!("activity consumer shutting down");
                    break;
                }
                result = consumer.recv() => {
                    let message = match result {
                        Ok(message) => message,
                        Err(e) => {
                            tracing::error!(error = ?e, "kafka receive error");
                            continue;
                        }
                    };
                    let kafka_message = message.inner();
                    let span = tracing::info_span!(
                        "activity_source_event",
                        topic = kafka_message.topic(),
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                    );
                    let decoded = {
                        let _guard = span.enter();
                        message.decode_payload()
                    };
                    let event = match decoded {
                        Ok(event) => event,
                        Err(_) => {
                            // Poison record: commit so it cannot wedge the
                            // partition.
                            commit_logged(&consumer, kafka_message);
                            continue;
                        }
                    };

                    // A storage failure must abort the run: continuing and
                    // committing a later record on this partition would
                    // cumulatively commit past the failed one, losing it
                    // forever. Returning Err restarts the consumer from the
                    // last committed offset; deterministic activity ids make
                    // the replay idempotent.
                    self.apply(&event)
                        .instrument(span)
                        .await
                        .context("failed to store activities")?;
                    commit_logged(&consumer, kafka_message);
                }
            }
        }

        Ok(())
    }
}

fn commit_logged<C: MacroEventCollection + 'static>(
    consumer: &MacroEventConsumerService<C, KafkaConsumerAdapter<ActivityConsumerGroup, C>>,
    message: &BorrowedMessage<'_>,
) {
    match consumer.inner().commit_message(message, CommitMode::Async) {
        Ok(()) => tracing::trace!(
            partition = message.partition(),
            offset = message.offset(),
            "committed offset"
        ),
        Err(error) => tracing::error!(
            error = ?error,
            partition = message.partition(),
            offset = message.offset(),
            "failed to commit offset"
        ),
    }
}
