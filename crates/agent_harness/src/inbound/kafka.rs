//! Kafka consumer: every channel message, filtered down to the ones that
//! mention us.
//!
//! Scaffolding only - every operation is `todo!()`.
//!
//! The trigger is not an API call. The harness subscribes to `macro.channels`
//! and watches every message posted in every channel, so the filter in
//! [`crate::domain::mentions`] runs before anything expensive happens. A bad
//! predicate here spawns a Daytona sandbox and an agent_proxy chat for the
//! entire firehose, which is why the mention check is domain logic with its own
//! tests rather than an `if` in the poll loop.
//!
//! `ChannelMessagePostedMetadata` already carries `mentions`, `content`,
//! `thread_id`, and `sender`, so recognising a mention needs no database
//! lookup and no second subscription to `macro.mentions`.
//!
//! Offsets: the group starts at the newest offset, so the harness only ever
//! sees messages posted after it comes up. Starting at `earliest` would answer
//! every historical mention of the bot id - one sandbox and one chat per hit.
//!
//! Delivery is at-least-once, and both side effects (a sandbox, a chat) are
//! expensive and user-visible, so the worker must dedupe on
//! [`BotMention::message_id`] before acting. Redis is already a dependency;
//! `crates/task_dedup` exists if that proves too thin.
//!
//! `services/search_processing_service/src/inbound/kafka_consumer.rs` is the
//! reference for the parts this skeleton leaves out: bounded sequential
//! handoff, commit-after-handoff, committing malformed records so they cannot
//! wedge a partition, and bounded in-process retries.

use std::sync::Arc;
use std::time::Duration;

use channels::domain::broker_events::{ChannelMacroEvent, ChannelTopicEvent};
use channels::domain::side_effects::ChannelBotTrigger;
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent, MacroEventCollection, MacroEventConsumerService, MessageParts,
};
use rootcause::prelude::ResultExt as _;

use crate::domain::handler::MentionHandler;
use crate::domain::ports::{
    AgentSessionStore, ChannelReplier, RuntimeAttachments, SandboxProvider,
};

/// Consumer group owning this harness's channel-message offsets.
pub struct AgentHarnessConsumerGroup;

impl GroupName for AgentHarnessConsumerGroup {
    const GROUP_NAME: &'static str = "agent-harness";
}

macro_event_broker::declare_topics!(
    HarnessMacroEvent:
        ChannelMacroEvent,
);

/// The grouped Kafka adapter this harness polls through.
pub type HarnessKafkaAdapter = KafkaConsumerAdapter<AgentHarnessConsumerGroup, HarnessMacroEvent>;

/// The typed consumer the poll loop receives from.
pub type HarnessKafkaConsumer = MacroEventConsumerService<HarnessMacroEvent, HarnessKafkaAdapter>;

/// How long to wait before polling again after a receive error, so a broker
/// outage does not spin.
const RECEIVE_ERROR_RETRY_DELAY: Duration = Duration::from_secs(1);

/// Build the consumer: join the group and subscribe to every declared topic.
///
/// Offsets follow the group, so the very first run of a new group starts at the
/// newest offset and later runs resume from the last commit.
pub fn consumer(brokers: &str) -> Result<HarnessKafkaConsumer, rootcause::Report> {
    let consumer = KafkaEventConsumer::<AgentHarnessConsumerGroup>::from_env(brokers)?;
    let consumer = KafkaConsumerAdapter::<AgentHarnessConsumerGroup, ()>::new(consumer)
        .subscribe::<HarnessMacroEvent>()
        .context("failed to subscribe to agent harness event topics")?;
    Ok(MacroEventConsumerService::new(consumer))
}

/// Poll `macro.channels` forever, logging every message.
///
/// The handler is threaded through but deliberately not called yet:
/// [`crate::domain::mentions::mentions_harness`] is still `todo!()`, so
/// filtering would panic on the first message. Until it lands this proves the
/// group joins, the topic is subscribed, and payloads decode.
///
/// It does not commit offsets either - so a restart re-reads whatever was
/// uncommitted, which for a log-only loop is what you want.
pub async fn run<Provider, Attach, Sessions, Replier>(
    _handler: Arc<MentionHandler<Provider, Attach, Sessions, Replier>>,
    consumer: HarnessKafkaConsumer,
) -> anyhow::Result<()>
where
    Provider: SandboxProvider,
    Attach: RuntimeAttachments,
    Sessions: AgentSessionStore,
    Replier: ChannelReplier,
{
    tracing::info!(
        topics = ?HarnessMacroEvent::topics(),
        group = AgentHarnessConsumerGroup::GROUP_NAME,
        "agent harness listening for channel events"
    );

    loop {
        let message = match consumer.recv().await {
            Ok(message) => message,
            Err(error) => {
                tracing::error!(error = ?error, "kafka receive failed");
                tokio::time::sleep(RECEIVE_ERROR_RETRY_DELAY).await;
                continue;
            }
        };

        let topic = message.inner().topic().to_owned();
        let key = message.inner().key().map(str::to_owned);

        match message.decode_payload() {
            Ok(HarnessMacroEvent::ChannelMacroEvent(event)) => {
                log_channel_event(&topic, key.as_deref(), &event);
            }
            Err(error) => {
                tracing::warn!(
                    %topic,
                    ?key,
                    error = ?error,
                    "undecodable record; skipping"
                );
            }
        }
    }
}

/// Log one decoded channel event, naming the variant so the interesting ones
/// stand out from channel lifecycle noise.
fn log_channel_event(topic: &str, key: Option<&str>, event: &ChannelMacroEvent) {
    let envelope = event.event();
    let variant = match &envelope.event {
        ChannelTopicEvent::Created(_) => "channel.created",
        ChannelTopicEvent::Updated(_) => "channel.updated",
        ChannelTopicEvent::Deleted(_) => "channel.deleted",
        ChannelTopicEvent::MessagePosted(_) => "channel.message_posted",
        // A ping, not a message. Deliberately ignored: `channel.message_posted`
        // already carries the full mention list, so acting on this too would
        // start a run twice - once per mentioned entity.
        ChannelTopicEvent::Mentioned(_) => "channel.mentioned",
        ChannelTopicEvent::MessagePatched(_) => "channel.message_patched",
        ChannelTopicEvent::MessageDeleted(_) => "channel.message_deleted",
        ChannelTopicEvent::MessageAttachmentCreated(_) => "channel.message_attachment_created",
        ChannelTopicEvent::MessageAttachmentRemoved(_) => "channel.message_attachment_removed",
        ChannelTopicEvent::ParticipantAdded(_) => "channel.participant_added",
        ChannelTopicEvent::ParticipantRemoved(_) => "channel.participant_removed",
    };

    // Message bodies and mentions are the whole point of the smoke test, so a
    // posted message gets its own line with the fields the handler will read.
    if let ChannelTopicEvent::MessagePosted(posted) = &envelope.event {
        tracing::info!(
            %topic,
            ?key,
            event = variant,
            channel_id = %posted.channel_id,
            message_id = %posted.message_id,
            thread_id = ?posted.thread_id,
            mentions = ?posted.mentions,
            content = %posted.content,
            "message posted"
        );
        return;
    }

    tracing::info!(%topic, ?key, event = variant, "channel event");
}

/// Map a posted-message event onto `channels`' own [`ChannelBotTrigger`], the
/// same value the in-process side-effect path produces.
///
/// `channels::domain::side_effects::bot_mention_ids` does the matching, so the
/// `bot|<uuid>` form and the user-tagged-bot quirk stay owned by `channels`
/// instead of being reimplemented here.
///
/// Returns `None` for anything that is not a posted message, which is most of
/// the topic.
#[expect(
    dead_code,
    reason = "wired up once the loop dispatches instead of logging"
)]
fn to_trigger(_event: &ChannelMacroEvent) -> Option<ChannelBotTrigger> {
    todo!("match MessagePosted, build MutatedMessage, bot_ids via bot_mention_ids")
}
