//! Kafka consumer pushing changed bot profiles to the people who see them.
//!
//! Consumes the bot topic and, for every created, updated or deleted bot,
//! publishes its current profile. Delivery is at least once and a replay
//! only resends the profile as it is now. Malformed messages are committed so
//! they cannot wedge a partition; a failed push is retried with backoff, then
//! logged and committed. Shutting down mid-retry leaves the event uncommitted
//! to replay on restart.

use std::{future::Future, time::Duration};

use kafka_util::{GroupName, InitialOffset, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection, MacroEventConsumerService,
};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use rootcause::prelude::{Report, ResultExt as _};
use tracing::Instrument as _;

use crate::domain::{
    events::{BotMacroEvent, BotTopicEvent},
    models::BotId,
    ports::{BotProfilePublisher, BotRepo},
    profile_fanout::BotProfileFanout,
};

mod source {
    use super::BotMacroEvent;

    macro_event_broker::declare_topics!(BotSourceEvent: BotMacroEvent);
}
use source::BotSourceEvent;

/// Consumer group for bot profile pushes.
struct BotProfilePushGroup;

impl GroupName for BotProfilePushGroup {
    const GROUP_NAME: &'static str = "bot-profile-push";
    // A push only matters to the views open now; replaying the topic's
    // retention would resend profiles nobody is waiting for.
    const INITIAL_OFFSET: InitialOffset = InitialOffset::Latest;
}

/// Attempts per event before a failing push is logged and skipped.
const MAX_ATTEMPTS: u32 = 4;
/// Delay before the first retry; it doubles with each attempt.
const FIRST_RETRY_DELAY: Duration = Duration::from_secs(1);

/// Pushes the profile of each changed bot as its event arrives.
pub struct BotProfileConsumer<R, P> {
    fanout: BotProfileFanout<R, P>,
}

impl<R: BotRepo, P: BotProfilePublisher> BotProfileConsumer<R, P> {
    /// Build the consumer over a profile fan-out.
    pub fn new(fanout: BotProfileFanout<R, P>) -> Self {
        Self { fanout }
    }

    /// Publishes the changed bot's profile, retrying failures with
    /// exponential backoff, and gives up after [`MAX_ATTEMPTS`] with an
    /// error log.
    async fn publish_with_retries(&self, bot_id: BotId) {
        let mut delay = FIRST_RETRY_DELAY;
        for attempt in 1..=MAX_ATTEMPTS {
            let Err(error) = self.fanout.publish(bot_id).await else {
                return;
            };
            if attempt == MAX_ATTEMPTS {
                tracing::error!(
                    error = ?error,
                    %bot_id,
                    attempts = MAX_ATTEMPTS,
                    "giving up pushing a changed bot profile"
                );
                return;
            }
            tracing::warn!(
                error = ?error,
                %bot_id,
                attempt,
                "failed to push a changed bot profile; retrying"
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
        let consumer = KafkaEventConsumer::<BotProfilePushGroup>::from_env(brokers)?;
        let consumer = KafkaConsumerAdapter::<BotProfilePushGroup, ()>::new(consumer)
            .subscribe::<BotSourceEvent>()
            .context("failed to subscribe to the bot topic")?;
        let consumer = MacroEventConsumerService::<BotSourceEvent, _>::new(consumer);
        tracing::info!(
            topics = ?BotSourceEvent::topics(),
            group = BotProfilePushGroup::GROUP_NAME,
            "bot profile push consumer listening"
        );

        let mut shutdown = std::pin::pin!(shutdown);
        loop {
            tokio::select! {
                _ = &mut shutdown => {
                    tracing::info!("bot profile push consumer shutting down");
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
                        "bot_profile_push_event",
                        topic = kafka_message.topic(),
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                    );
                    let decoded = {
                        let _guard = span.enter();
                        message.decode_payload()
                    };
                    let Ok(BotSourceEvent::BotMacroEvent(event)) = decoded else {
                        // Poison record: commit so it cannot wedge the partition.
                        commit_logged(&consumer, kafka_message);
                        continue;
                    };
                    let bot_id = match &event.event().event {
                        BotTopicEvent::Created(metadata) => metadata.bot_id,
                        BotTopicEvent::Updated(metadata) => metadata.bot_id,
                        BotTopicEvent::Deleted(metadata) => metadata.bot_id,
                    };

                    // Shutting down mid-retry leaves the event uncommitted so
                    // it replays on restart.
                    tokio::select! {
                        _ = &mut shutdown => break,
                        () = self.publish_with_retries(bot_id).instrument(span) => {}
                    }
                    commit_logged(&consumer, kafka_message);
                }
            }
        }

        Ok(())
    }
}

fn commit_logged<C: MacroEventCollection + 'static>(
    consumer: &MacroEventConsumerService<C, KafkaConsumerAdapter<BotProfilePushGroup, C>>,
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
