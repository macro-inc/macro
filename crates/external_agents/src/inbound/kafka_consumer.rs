//! Kafka consumer recording agent triggers in external agents' inboxes.
//!
//! Consumes the agent-trigger topic under its own group. Delivery is at
//! least once: recording is idempotent per trigger, and a push of an event
//! already pushed is delivered once. Malformed records are committed so they
//! cannot wedge a partition. A failing trigger is retried with backoff; one
//! that still fails is logged and committed, so one bad trigger never stalls
//! the agents behind it. Shutting down mid-retry leaves the trigger
//! uncommitted to replay on restart.

use std::{future::Future, time::Duration};

use agent_trigger::domain::broker_events::{AgentSessionMacroEvent, AgentTriggerTopicEvent};
use kafka_util::{GroupName, InitialOffset, KafkaEventConsumer};
use macro_event_broker::{
    Event, KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection, MacroEventConsumerService,
};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use rootcause::prelude::{Report, ResultExt as _};
use tracing::Instrument as _;

use crate::domain::ports::ExternalAgentInbox;

mod source {
    use super::AgentSessionMacroEvent;

    macro_event_broker::declare_topics!(TriggerSourceEvent: AgentSessionMacroEvent);
}
use source::TriggerSourceEvent;

/// Consumer group for external agent inbox offsets.
struct ExternalAgentInboxGroup;

impl GroupName for ExternalAgentInboxGroup {
    const GROUP_NAME: &'static str = "external-agent-inbox";
    // Triggers published before the group first joined predate every
    // external agent; replaying the topic's retention would record nothing.
    const INITIAL_OFFSET: InitialOffset = InitialOffset::Latest;
}

/// Attempts per trigger before a failing one is logged and skipped.
const MAX_ATTEMPTS: u32 = 4;
/// Delay before the first retry; it doubles with each attempt.
const FIRST_RETRY_DELAY: Duration = Duration::from_secs(1);

/// Records agent triggers in external agents' inboxes as they arrive.
pub struct ExternalAgentInboxConsumer<I> {
    inbox: I,
}

impl<I: ExternalAgentInbox> ExternalAgentInboxConsumer<I> {
    /// Build the consumer over an inbox.
    pub fn new(inbox: I) -> Self {
        Self { inbox }
    }

    async fn record_with_retries(&self, trigger: &Event<AgentTriggerTopicEvent>) {
        let mut delay = FIRST_RETRY_DELAY;
        for attempt in 1..=MAX_ATTEMPTS {
            let Err(error) = self.inbox.record_trigger(trigger).await else {
                return;
            };
            if attempt == MAX_ATTEMPTS {
                tracing::error!(
                    error = ?error,
                    trigger_event_id = %trigger.event_id,
                    attempts = MAX_ATTEMPTS,
                    "giving up recording an agent trigger for an external agent"
                );
                return;
            }
            tracing::warn!(
                error = ?error,
                trigger_event_id = %trigger.event_id,
                attempt,
                "failed to record an agent trigger for an external agent; retrying"
            );
            tokio::time::sleep(delay).await;
            delay *= 2;
        }
    }

    /// Runs the consumer until `shutdown` resolves.
    #[tracing::instrument(skip(self, shutdown), err)]
    pub async fn run(
        &self,
        brokers: &str,
        shutdown: impl Future<Output = ()> + Send,
    ) -> Result<(), Report> {
        let consumer = KafkaEventConsumer::<ExternalAgentInboxGroup>::from_env(brokers)?;
        let consumer = KafkaConsumerAdapter::<ExternalAgentInboxGroup, ()>::new(consumer)
            .subscribe::<TriggerSourceEvent>()
            .context("failed to subscribe to the agent trigger topic")?;
        let consumer = MacroEventConsumerService::<TriggerSourceEvent, _>::new(consumer);
        tracing::info!(
            topics = ?TriggerSourceEvent::topics(),
            group = ExternalAgentInboxGroup::GROUP_NAME,
            "external agent inbox consumer listening"
        );

        let mut shutdown = std::pin::pin!(shutdown);
        loop {
            tokio::select! {
                _ = &mut shutdown => {
                    tracing::info!("external agent inbox consumer shutting down");
                    break;
                }
                result = consumer.recv() => {
                    let message = match result {
                        Ok(message) => message,
                        Err(error) => {
                            tracing::error!(error = ?error, "kafka receive error");
                            continue;
                        }
                    };
                    let kafka_message = message.inner();
                    let span = tracing::info_span!(
                        "external_agent_inbox_event",
                        topic = kafka_message.topic(),
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                    );
                    let decoded = {
                        let _guard = span.enter();
                        message.decode_payload()
                    };
                    let Ok(TriggerSourceEvent::AgentSessionMacroEvent(event)) = decoded else {
                        // Poison record: commit so it cannot wedge the partition.
                        commit_logged(&consumer, kafka_message);
                        continue;
                    };

                    tokio::select! {
                        _ = &mut shutdown => break,
                        () = self.record_with_retries(event.event()).instrument(span) => {}
                    }
                    commit_logged(&consumer, kafka_message);
                }
            }
        }

        Ok(())
    }
}

fn commit_logged<C: MacroEventCollection + 'static>(
    consumer: &MacroEventConsumerService<C, KafkaConsumerAdapter<ExternalAgentInboxGroup, C>>,
    message: &BorrowedMessage<'_>,
) {
    if let Err(error) = consumer.inner().commit_message(message, CommitMode::Async) {
        tracing::error!(
            error = ?error,
            partition = message.partition(),
            offset = message.offset(),
            "failed to commit offset"
        );
    }
}
