//! Typed producer and consumer services.

#[cfg(test)]
mod test;

use std::borrow::Cow;
use std::marker::PhantomData;
use std::sync::Arc;
use std::time::Duration;

use opentelemetry::KeyValue;
use opentelemetry::metrics::{Counter, Meter};
use serde::Deserialize;
use tracing::Instrument as _;

use crate::MessageWrapper;
use crate::domain::models::{EventBrokerError, MacroEvent, TopicEvent};
use crate::domain::ports::{
    EventConsumer, EventPublisher, MacroEventBroker, MacroEventCollection, Spawner,
};

const PUBLISH_TIMEOUT: Duration = Duration::from_secs(6);
/// Meter every [`MacroEventBrokerService`] records its publishes on.
const METER_NAME: &str = "macro_event_broker";
/// Counter of publish attempts, tagged `topic`, `event_type` and `outcome`.
const PUBLISHES: &str = "event_broker.publishes";
const TOPIC_TAG: &str = "topic";
const EVENT_TYPE_TAG: &str = "event_type";
const OUTCOME_TAG: &str = "outcome";

/// How one [`MacroEventBroker::send_event`] ended, the `outcome` tag of
/// [`PUBLISHES`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum PublishOutcome {
    /// The broker acknowledged the event.
    Published,
    /// The publisher returned an error.
    Failed,
    /// The publish did not finish within [`PUBLISH_TIMEOUT`].
    TimedOut,
    /// The event did not serialize, so nothing was sent.
    Unserializable,
    /// The publish task was dropped before it finished, e.g. aborted.
    Cancelled,
}

/// Counts one publish in [`PUBLISHES`] when dropped, with the outcome it was
/// given, or [`PublishOutcome::Cancelled`] if its task never set one.
struct PublishCount {
    publishes: Counter<u64>,
    topic: &'static str,
    event_type: Option<String>,
    outcome: PublishOutcome,
}

impl Drop for PublishCount {
    fn drop(&mut self) {
        let mut tags = vec![
            KeyValue::new(TOPIC_TAG, self.topic),
            KeyValue::new(OUTCOME_TAG, <&str>::from(self.outcome)),
        ];
        if let Some(event_type) = self.event_type.take() {
            tags.push(KeyValue::new(EVENT_TYPE_TAG, event_type));
        }
        self.publishes.add(1, &tags);
    }
}

/// The wire `event_type` of a serialized [`Event`](crate::Event): the tag
/// every [`TopicEvent`] enum serializes its variant under. It tells live
/// changes from bulk work on one topic, e.g. `email.message_received` from
/// `email.thread_backfilled`.
fn wire_event_type(payload: &[u8]) -> Option<String> {
    #[derive(Deserialize)]
    struct Tag<'a> {
        #[serde(borrow)]
        event_type: Option<Cow<'a, str>>,
    }
    serde_json::from_slice::<Tag<'_>>(payload)
        .ok()?
        .event_type
        .map(Cow::into_owned)
}

/// Receives transport messages associated with a declared macro event collection.
pub struct MacroEventConsumerService<M, C>
where
    M: MacroEventCollection,
    C: EventConsumer<M>,
{
    consumer: C,
    marker: PhantomData<fn() -> M>,
}

impl<M, C> MacroEventConsumerService<M, C>
where
    M: MacroEventCollection,
    C: EventConsumer<M>,
{
    /// Creates a typed consumer service backed by `consumer`.
    pub const fn new(consumer: C) -> Self {
        Self {
            consumer,
            marker: PhantomData,
        }
    }

    /// Receives the next message from the underlying consumer.
    ///
    /// Call [`MessageWrapper::decode_payload`] to decode its declared event.
    pub async fn recv<'a>(
        &'a self,
    ) -> Result<MessageWrapper<C::MessageType<'a>, M>, rootcause::Report> {
        self.consumer.recv().await
    }

    /// Returns the underlying consumer.
    ///
    /// This provides access to transport-specific delivery operations after a
    /// message has been received through this service.
    pub const fn inner(&self) -> &C {
        &self.consumer
    }
}

/// Orchestrates serializing events and handing them to an [`EventPublisher`].
pub struct MacroEventBrokerService<P: EventPublisher, S: Spawner> {
    publisher: Arc<P>,
    spawner: S,
    publishes: Counter<u64>,
}

impl<P, S> Clone for MacroEventBrokerService<P, S>
where
    P: EventPublisher,
    S: Spawner + Clone,
{
    fn clone(&self) -> Self {
        Self {
            publisher: Arc::clone(&self.publisher),
            spawner: self.spawner.clone(),
            publishes: self.publishes.clone(),
        }
    }
}

impl<P: EventPublisher, S: Spawner> MacroEventBrokerService<P, S> {
    /// Creates a new service backed by the given outbound publisher and task
    /// spawner, counting its publishes on the global meter provider.
    pub fn new(publisher: P, spawner: S) -> Self {
        Self::with_meter(
            publisher,
            spawner,
            &opentelemetry::global::meter(METER_NAME),
        )
    }

    /// Like [`Self::new`], counting publishes on `meter`.
    pub fn with_meter(publisher: P, spawner: S, meter: &Meter) -> Self {
        Self {
            publisher: Arc::new(publisher),
            spawner,
            publishes: meter
                .u64_counter(PUBLISHES)
                .with_description(
                    "Events handed to the broker, by topic, wire event type and outcome",
                )
                .build(),
        }
    }
}

impl<P: EventPublisher, S: Spawner> MacroEventBroker for MacroEventBrokerService<P, S> {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        let topic = event.topic();
        let key = event.key().to_owned();
        let payload = serde_json::to_vec(event.event()).inspect_err(|_| {
            self.publishes.add(
                1,
                &[
                    KeyValue::new(TOPIC_TAG, topic),
                    KeyValue::new(OUTCOME_TAG, <&str>::from(PublishOutcome::Unserializable)),
                ],
            );
        })?;
        let publisher = Arc::clone(&self.publisher);
        // Moved into the task, so a task dropped before it finishes still counts.
        let mut count = PublishCount {
            publishes: self.publishes.clone(),
            topic,
            event_type: wire_event_type(&payload),
            outcome: PublishOutcome::Cancelled,
        };
        let span = tracing::Span::current();

        let handle = self.spawner.spawn(
            async move {
                let result = tokio::time::timeout(
                    PUBLISH_TIMEOUT,
                    publisher.publish::<<<E as MacroEvent>::EventPayload as TopicEvent>::Topic>(
                        &key,
                        count.event_type.as_deref(),
                        &payload,
                    ),
                )
                .await
                .map_err(|_| EventBrokerError::PublishTimeout {
                    timeout: PUBLISH_TIMEOUT,
                })
                .and_then(std::convert::identity);
                count.outcome = match &result {
                    Ok(()) => PublishOutcome::Published,
                    Err(EventBrokerError::PublishTimeout { .. }) => PublishOutcome::TimedOut,
                    Err(_) => PublishOutcome::Failed,
                };
                drop(count);
                result.inspect_err(|error| {
                    tracing::error!(
                        error = ?error,
                        topic,
                        key = %key,
                        "failed to publish event",
                    );
                })
            }
            .instrument(span),
        );

        Ok(handle)
    }
}

/// A [`MacroEventBroker`] that drops every event.
///
/// Useful as a default type parameter for services that publish events
/// optionally, and in tests that don't care about published events.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoopMacroEventBroker;

impl MacroEventBroker for NoopMacroEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        _event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        Ok(tokio::spawn(async { Ok(()) }))
    }
}
