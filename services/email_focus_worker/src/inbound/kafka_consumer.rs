//! Classify a thread whenever mail arrives in it or its owner sends a reply.
//!
//! Every email event on the platform passes through here, so the consumer
//! hands each thread to the Focus service, which drops inboxes off the
//! allowlist after a single-row read. Up to [`MAX_CONCURRENT_CLASSIFICATIONS`]
//! threads run side by side, so a slow classifier call delays only its own
//! thread; with every slot taken the consumer stops reading until one frees.
//!
//! An event's offset is committed when it is handed off, in the order received,
//! not when its classification ends. So an event is never replayed, and one in
//! flight when the worker dies is lost like any failed classification. The sweep
//! that runs when the worker starts picks those up, newest first.

use std::{future::Future, sync::Arc};

use chrono::Utc;
use email::domain::{
    events::{EmailMacroEvent, EmailTopicEvent},
    focus::{
        ClassifyOutcome, FocusClassifier, FocusNotifier, FocusService, FocusStore, ProfileSource,
    },
};
use kafka_util::{GroupName, InitialOffset, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _, MacroEventConsumerService,
};
use rdkafka::{Message as _, consumer::CommitMode};
use rootcause::Report;
use tokio_util::sync::CancellationToken;
use tracing::{Instrument as _, field::Empty};
use uuid::Uuid;

use self::classifications::Classifications;

mod classifications;
#[cfg(test)]
mod test;

macro_event_broker::declare_topics!(FocusEvent: EmailMacroEvent);

struct EmailFocusGroup;

impl GroupName for EmailFocusGroup {
    const GROUP_NAME: &'static str = "email-focus";
    // The sweep covers mail from before the group existed; never replay the topic.
    const INITIAL_OFFSET: InitialOffset = InitialOffset::Latest;
}

/// The thread an event touches, when the event can change the thread's Focus.
fn thread_to_classify(event: &EmailTopicEvent) -> Option<Uuid> {
    match event {
        EmailTopicEvent::MessageReceived(message) if !message.is_spam_or_trash => {
            Some(message.thread_id)
        }
        // The owner's reply clears "reply needed" and can open a follow-up.
        EmailTopicEvent::MessageSent(message) => Some(message.thread_id),
        _ => None,
    }
}

/// Threads classified at once. Each holds at most one thread's recent mail in
/// memory and a classifier call that its own deadline bounds.
const MAX_CONCURRENT_CLASSIFICATIONS: usize = 16;

/// How long ago the event was published, by the Kafka record's timestamp.
fn event_age_ms(published_at_ms: Option<i64>) -> Option<i64> {
    published_at_ms.map(|published_at_ms| Utc::now().timestamp_millis() - published_at_ms)
}

fn outcome_name(outcome: &ClassifyOutcome) -> &'static str {
    match outcome {
        ClassifyOutcome::Classified(_) => "classified",
        ClassifyOutcome::Redecided(_) => "redecided",
        ClassifyOutcome::UpToDate => "up_to_date",
        ClassifyOutcome::Missing => "missing",
        ClassifyOutcome::NotSignal => "not_signal",
        ClassifyOutcome::NotEnabled => "not_enabled",
        ClassifyOutcome::Unavailable => "unavailable",
        ClassifyOutcome::Rejected => "rejected",
    }
}

async fn classify<S, P, C, N>(
    service: &FocusService<S, P, C, N>,
    thread_id: Uuid,
    published_at_ms: Option<i64>,
) where
    S: FocusStore,
    P: ProfileSource,
    C: FocusClassifier,
    N: FocusNotifier,
{
    let span = tracing::info_span!(
        "email_focus.classify",
        %thread_id,
        outcome = Empty,
        event_age_ms = Empty,
        otel.status_code = Empty,
        otel.status_description = Empty,
    );
    let result = service
        .classify_thread(thread_id)
        .instrument(span.clone())
        .await;
    span.record("event_age_ms", event_age_ms(published_at_ms));
    let _in_span = span.enter();
    match result {
        Ok(outcome) => {
            span.record("outcome", outcome_name(&outcome));
            match outcome {
                ClassifyOutcome::Classified(verdict) | ClassifyOutcome::Redecided(verdict) => {
                    tracing::info!(
                        %thread_id,
                        is_focus = verdict.is_focus,
                        category = %verdict.category,
                        importance = verdict.importance,
                        "focus classified"
                    );
                }
                ClassifyOutcome::Unavailable | ClassifyOutcome::Rejected => {
                    tracing::warn!(%thread_id, ?outcome, "focus classification left for the sweep");
                }
                _ => tracing::debug!(%thread_id, ?outcome, "focus skipped"),
            }
        }
        Err(error) => {
            span.record("outcome", "failed");
            kafka_util::record_span_error(&span, "focus classification failed");
            tracing::warn!(%thread_id, error = ?error, "focus classification failed");
        }
    }
}

/// The work for one event: waiting for a slot, then classifying, in the event's
/// trace. Nothing happens until it runs.
fn classification<S, P, C, N>(
    service: Arc<FocusService<S, P, C, N>>,
    thread_id: Uuid,
    published_at_ms: Option<i64>,
    event_span: tracing::Span,
) -> impl Future<Output = ()> + Send + 'static
where
    S: FocusStore,
    P: ProfileSource,
    C: FocusClassifier,
    N: FocusNotifier,
{
    let queued = tracing::info_span!(
        parent: &event_span,
        "email_focus.queue",
        %thread_id,
        event_age_ms = event_age_ms(published_at_ms),
    );
    async move {
        drop(queued);
        classify(&service, thread_id, published_at_ms).await;
    }
    .instrument(event_span)
}

/// Consume `macro.email` under the `email-focus` group until `shutdown`, which
/// drops the classifications in flight. Receive and commit failures are logged
/// and skipped, as in the activity consumer: a restart would only re-run the
/// startup sweep.
pub async fn run_focus_consumer<S, P, C, N>(
    brokers: &str,
    service: Arc<FocusService<S, P, C, N>>,
    shutdown: CancellationToken,
) -> Result<(), Report>
where
    S: FocusStore,
    P: ProfileSource,
    C: FocusClassifier,
    N: FocusNotifier,
{
    let consumer = KafkaEventConsumer::<EmailFocusGroup>::from_env(brokers)?;
    let consumer =
        KafkaConsumerAdapter::<EmailFocusGroup, ()>::new(consumer).subscribe::<FocusEvent>()?;
    let consumer = MacroEventConsumerService::new(consumer);
    tracing::info!(
        topics = ?FocusEvent::topics(),
        group = EmailFocusGroup::GROUP_NAME,
        "email focus consumer listening"
    );
    let mut classifications = Classifications::new(MAX_CONCURRENT_CLASSIFICATIONS);
    loop {
        let message = tokio::select! {
            biased;
            () = shutdown.cancelled() => break,
            () = classifications.next_finished() => continue,
            result = consumer.recv(), if classifications.has_room() => match result {
                Ok(message) => message,
                Err(error) => {
                    tracing::error!(error = ?error, "kafka receive error");
                    continue;
                }
            },
        };
        let span = kafka_util::consumer_span(message.inner(), EmailFocusGroup::GROUP_NAME);
        let thread_id = match message.decode_payload() {
            Ok(FocusEvent::EmailMacroEvent(event)) => thread_to_classify(&event.event().event),
            Err(_) => {
                // Decode errors can echo payload text; log only that it happened.
                tracing::warn!(parent: &span, "undecodable email event skipped");
                None
            }
        };
        if let Some(thread_id) = thread_id {
            let published_at_ms = message.inner().timestamp().to_millis();
            classifications.submit(
                thread_id,
                classification(Arc::clone(&service), thread_id, published_at_ms, span),
            );
        }
        if let Err(error) = consumer
            .inner()
            .commit_message(message.inner(), CommitMode::Async)
        {
            tracing::error!(error = ?error, "kafka commit error");
        }
    }
    classifications.shutdown().await;
    Ok(())
}
