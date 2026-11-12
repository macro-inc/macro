//! Kafka consumer that keeps channel messages' link previews current.
//!
//! Subscribes to `macro.messages` under the `message-link-previews` group and
//! refreshes a channel message's previews after each post or patch, whichever
//! process posted it. Refreshing reads the message's current content, so it is
//! safe to repeat and to run late.
//!
//! Fetching a page can take seconds, so refreshes run concurrently, up to
//! [`MAX_IN_FLIGHT`], and the offset is committed once a refresh is scheduled.
//! Events for a message already refreshing coalesce into one follow-up run: a
//! streamed agent reply patches its message many times. Previews are
//! best-effort display enrichment: a refresh still failing after its retries,
//! or one in flight when the process stops, leaves the message without them.

#[cfg(test)]
mod test;

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use kafka_util::{GroupName, InitialOffset, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _, MacroEventConsumerService,
};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use tokio::sync::Semaphore;
use tokio_retry::{Retry, strategy::ExponentialBackoff};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::Instrument as _;
use uuid::Uuid;

use crate::domain::{api::MessageLinkPreviews, models::MessageParent};
use crate::outbound::broker::{MessageMacroEvent, MessageTopicEvent};

/// Refreshes running at once; further events wait, pausing consumption.
const MAX_IN_FLIGHT: usize = 16;

/// Attempts per refresh before it is dropped.
const MAX_ATTEMPTS: usize = 3;

struct LinkPreviewConsumerGroup;

impl GroupName for LinkPreviewConsumerGroup {
    const GROUP_NAME: &'static str = "message-link-previews";
    // A new group must not replay the topic's retention: old messages would
    // all be unfurled at once, and they render fine without previews.
    const INITIAL_OFFSET: InitialOffset = InitialOffset::Latest;
}

macro_event_broker::declare_topics!(DeclaredMacroEvent: MessageMacroEvent);

type LinkPreviewKafkaAdapter = KafkaConsumerAdapter<LinkPreviewConsumerGroup, DeclaredMacroEvent>;
type LinkPreviewKafkaConsumer =
    MacroEventConsumerService<DeclaredMacroEvent, LinkPreviewKafkaAdapter>;

/// The channel message whose previews a fact may have changed.
fn refresh_target(event: &MessageTopicEvent) -> Option<(MessageParent, Uuid)> {
    let (parent, message_id) = match event {
        MessageTopicEvent::Posted(metadata) => (&metadata.parent, metadata.message_id),
        MessageTopicEvent::Patched(metadata) => (&metadata.parent, metadata.message_id),
        MessageTopicEvent::Deleted(_)
        | MessageTopicEvent::Mentioned(_)
        | MessageTopicEvent::AttachmentCreated(_)
        | MessageTopicEvent::AttachmentRemoved(_) => return None,
    };
    matches!(parent, MessageParent::Channel(_)).then(|| (parent.clone(), message_id))
}

/// Runs refreshes concurrently, at most one per message at a time.
struct Refresher<S> {
    previews: Arc<S>,
    slots: Arc<Semaphore>,
    /// Messages refreshing now, with the span of a run requested meanwhile.
    running: Arc<Mutex<HashMap<Uuid, Option<tracing::Span>>>>,
    tasks: TaskTracker,
    cancel: CancellationToken,
}

impl<S: MessageLinkPreviews> Refresher<S> {
    fn new(previews: Arc<S>, slots: usize) -> Self {
        Self {
            previews,
            slots: Arc::new(Semaphore::new(slots)),
            running: Arc::new(Mutex::new(HashMap::new())),
            tasks: TaskTracker::new(),
            cancel: CancellationToken::new(),
        }
    }

    /// Stop the refreshes under way and wait for them to end.
    async fn shutdown(&self) {
        self.cancel.cancel();
        self.tasks.close();
        self.tasks.wait().await;
    }

    /// Refresh `id`, or run it again after the refresh already under way.
    /// Waits for a free slot before starting a new refresh.
    async fn schedule(&self, parent: MessageParent, id: Uuid, span: tracing::Span) {
        if let Some(rerun) = lock(&self.running).get_mut(&id) {
            *rerun = Some(span);
            return;
        }

        let Ok(slot) = self.slots.clone().acquire_owned().await else {
            return;
        };
        lock(&self.running).insert(id, None);
        let previews = self.previews.clone();
        let running = self.running.clone();
        let cancel = self.cancel.clone();
        self.tasks.spawn(async move {
            let mut span = span;
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    () = refresh_with_retry(previews.as_ref(), &parent, id).instrument(span) => {}
                }
                let mut running = lock(&running);
                match running.get_mut(&id).and_then(Option::take) {
                    Some(next) => span = next,
                    None => {
                        running.remove(&id);
                        break;
                    }
                }
            }
            drop(slot);
        });
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    // The map holds no invariant a panicking holder could break midway.
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

async fn refresh_with_retry<S: MessageLinkPreviews>(
    previews: &S,
    parent: &MessageParent,
    id: Uuid,
) {
    let strategy = ExponentialBackoff::from_millis(2)
        .factor(250)
        .max_delay(Duration::from_secs(5))
        .take(MAX_ATTEMPTS - 1);
    let result = Retry::start(strategy, || previews.refresh_link_previews(parent, id)).await;
    if let Err(error) = result {
        let span = tracing::Span::current();
        kafka_util::record_span_error(&span, &error);
        tracing::warn!(error = %error, message_id = %id, "dropping link preview refresh");
    }
}

fn commit_logged(consumer: &LinkPreviewKafkaConsumer, message: &BorrowedMessage<'_>) {
    if let Err(error) = consumer.inner().commit_message(message, CommitMode::Async) {
        tracing::error!(
            error = ?error,
            partition = message.partition(),
            offset = message.offset(),
            "failed to commit offset"
        );
    }
}

/// Run the link preview consumer until `shutdown` resolves. Callers restart
/// it on error.
pub async fn run_link_preview_consumer<S: MessageLinkPreviews>(
    brokers: &str,
    previews: Arc<S>,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), rootcause::Report> {
    let consumer = KafkaEventConsumer::<LinkPreviewConsumerGroup>::from_env(brokers)
        .map_err(rootcause::Report::new)?;
    let consumer = KafkaConsumerAdapter::<LinkPreviewConsumerGroup, ()>::new(consumer)
        .subscribe::<DeclaredMacroEvent>()?;
    let consumer = LinkPreviewKafkaConsumer::new(consumer);
    tracing::info!(
        topics = ?DeclaredMacroEvent::topics(),
        group = LinkPreviewConsumerGroup::GROUP_NAME,
        "link preview consumer listening"
    );

    let refresher = Refresher::new(previews, MAX_IN_FLIGHT);
    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            result = consumer.recv() => {
                let message = match result {
                    Ok(message) => message,
                    Err(error) => {
                        tracing::error!(error = ?error, "kafka receive error");
                        continue;
                    }
                };
                let kafka_message = message.inner();
                match message.decode_payload() {
                    Ok(DeclaredMacroEvent::MessageMacroEvent(event)) => {
                        if let Some((parent, id)) = refresh_target(&event.event().event) {
                            let span = kafka_util::consumer_span(
                                kafka_message,
                                LinkPreviewConsumerGroup::GROUP_NAME,
                            );
                            refresher.schedule(parent, id, span).await;
                        }
                    }
                    Err(error) => tracing::error!(
                        error = ?error,
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                        "failed to decode message event"
                    ),
                }
                commit_logged(&consumer, kafka_message);
            }
        }
    }
    refresher.shutdown().await;
    Ok(())
}
