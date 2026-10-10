//! Classify a thread whenever mail arrives in it or its owner sends a reply.
//!
//! Every email event on the platform passes through here, so the consumer
//! hands each thread to the Focus service, which drops inboxes off the
//! allowlist after a single-row read. Offsets are committed whatever the
//! outcome: a lost or failed classification is picked up by the hourly sweep.

use std::{future::Future, sync::Arc};

use email::domain::{
    events::{EmailMacroEvent, EmailTopicEvent},
    focus::{ClassifyOutcome, FocusClassifier, FocusService, FocusStore, ProfileSource},
};
use kafka_util::{GroupName, InitialOffset, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _, MacroEventConsumerService,
};
use rdkafka::consumer::CommitMode;
use rootcause::Report;
use tracing::Instrument as _;
use uuid::Uuid;

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

async fn classify<S, P, C>(service: &FocusService<S, P, C>, thread_id: Uuid)
where
    S: FocusStore,
    P: ProfileSource,
    C: FocusClassifier,
{
    match service.classify_thread(thread_id).await {
        Ok(ClassifyOutcome::Classified(verdict)) => tracing::info!(
            %thread_id,
            is_focus = verdict.is_focus,
            category = %verdict.category,
            importance = verdict.importance,
            "focus classified"
        ),
        Ok(outcome @ (ClassifyOutcome::Unavailable | ClassifyOutcome::Rejected)) => {
            tracing::warn!(%thread_id, ?outcome, "focus classification left for the sweep");
        }
        Ok(outcome) => tracing::debug!(%thread_id, ?outcome, "focus skipped"),
        Err(error) => {
            tracing::warn!(%thread_id, error = ?error, "focus classification failed");
        }
    }
}

/// Consume `macro.email` under the `email-focus` group until `shutdown`
/// resolves. Receive and commit failures end the consumer; restart it fresh.
pub async fn run_focus_consumer<S, P, C>(
    brokers: &str,
    service: Arc<FocusService<S, P, C>>,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), Report>
where
    S: FocusStore,
    P: ProfileSource,
    C: FocusClassifier,
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
    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        let message = tokio::select! {
            biased;
            () = &mut shutdown => return Ok(()),
            result = consumer.recv() => result?,
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
            tokio::select! {
                biased;
                // Uncommitted: the event is redelivered to the next consumer.
                () = &mut shutdown => return Ok(()),
                () = classify(&service, thread_id).instrument(span.clone()) => {}
            }
        }
        consumer
            .inner()
            .commit_message(message.inner(), CommitMode::Async)?;
    }
}
