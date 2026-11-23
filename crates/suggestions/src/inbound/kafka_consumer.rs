//! Resolves suggestions from the events that end them: the person's own sent email
//! or posted message, a deleted item, a change to who can open one.
//!
//! Records are handled one at a time and committed after. Resolving twice is a
//! no-op, so a redelivered record does nothing new; a record that can't be
//! decoded, or keeps failing, is logged and committed so it never stalls the
//! partition. A missed resolution is covered by the feed's access filter and
//! the next generation session.

#[cfg(test)]
mod test;

use std::future::Future;
use std::str::FromStr as _;
use std::time::Duration;

use channels::domain::broker_events::{ChannelMacroEvent, ChannelTopicEvent};
use documents::domain::events::{DocumentMacroEvent, DocumentTopicEvent};
use email::domain::events::{EmailMacroEvent, EmailTopicEvent};
use kafka_util::{GroupName, InitialOffset, KafkaEventConsumer};
use macro_event_broker::{
    EventConsumer, KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _,
    MacroEventConsumerService, MessageWrapper,
};
use messages::domain::models::MessageParent;
use messages::outbound::broker::{MessageMacroEvent, MessageTopicEvent};
use model_entity::EntityType;
use projects::domain::events::{ProjectMacroEvent, ProjectTopicEvent};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message};
use rootcause::Report;
use tracing::Instrument as _;

use crate::domain::ports::ResolveSuggestions;
use crate::domain::resolution::{Item, ResolutionEvent};

macro_event_broker::declare_topics!(
    SuggestionEvent: DocumentMacroEvent,
    ChannelMacroEvent,
    MessageMacroEvent,
    EmailMacroEvent,
    ProjectMacroEvent
);

struct SuggestionResolutionGroup;

impl GroupName for SuggestionResolutionGroup {
    const GROUP_NAME: &'static str = "suggestions-resolution";
    // A new group starts at each topic's head: suggestions only need what happens
    // from now on, not each topic's retention.
    const INITIAL_OFFSET: InitialOffset = InitialOffset::Latest;
}

type SuggestionKafkaAdapter = KafkaConsumerAdapter<SuggestionResolutionGroup, SuggestionEvent>;

const MAX_ATTEMPTS: u8 = 4;
// Three delays (1+2+4 seconds) before the fourth and final attempt.
const RETRY_BASE_DELAY: Duration = Duration::from_secs(1);

// Transport-only seam, so tests run the receive/resolve/commit loop without a
// broker.
trait CommittingConsumer: EventConsumer<SuggestionEvent> {
    fn commit(&self, message: &Self::MessageType<'_>) -> Result<(), Report>;
}

impl CommittingConsumer for SuggestionKafkaAdapter {
    fn commit(&self, message: &BorrowedMessage<'_>) -> Result<(), Report> {
        self.commit_message(message, CommitMode::Sync)
    }
}

fn item(entity_type: EntityType, entity_id: impl Into<String>) -> Item {
    Item {
        entity_type,
        entity_id: entity_id.into(),
    }
}

/// The item a message's parent is, when suggestions can name it.
fn parent_item(parent: &MessageParent) -> Option<Item> {
    let entity_type = EntityType::from_str(parent.entity_type()).ok()?;
    Some(item(entity_type, parent.entity_id()))
}

/// What a decoded record means for suggestions, if anything.
fn resolution_event(event: &SuggestionEvent) -> Option<ResolutionEvent> {
    match event {
        SuggestionEvent::EmailMacroEvent(event) => match &event.event().event {
            // Sent by the inbox's owner, through Macro or (no actor) from
            // another client.
            EmailTopicEvent::MessageSent(sent) => Some(ResolutionEvent::Replied {
                user: sent.actor.clone().unwrap_or_else(|| sent.owner.clone()),
                item: item(EntityType::EmailThread, sent.thread_id.to_string()),
                thread: None,
                at: sent.sent_at,
            }),
            _ => None,
        },
        SuggestionEvent::MessageMacroEvent(event) => match &event.event().event {
            MessageTopicEvent::Posted(posted) => Some(ResolutionEvent::Replied {
                // A bot's post never answers for the person.
                user: posted.sender.as_user()?.clone(),
                item: parent_item(&posted.parent)?,
                thread: posted.thread_id.map(|thread| thread.to_string()),
                at: posted.created_at,
            }),
            MessageTopicEvent::Deleted(deleted) => Some(ResolutionEvent::Deleted {
                item: parent_item(&deleted.parent)?,
                part: Some(deleted.message_id.to_string()),
            }),
            _ => None,
        },
        SuggestionEvent::ChannelMacroEvent(event) => match &event.event().event {
            ChannelTopicEvent::Deleted(deleted) => Some(ResolutionEvent::Deleted {
                item: item(EntityType::Channel, deleted.channel_id.to_string()),
                part: None,
            }),
            ChannelTopicEvent::ParticipantRemoved(removed) => {
                Some(ResolutionEvent::AccessChanged {
                    item: item(EntityType::Channel, removed.channel_id.to_string()),
                    users: Some(removed.removed_user_ids.clone()),
                })
            }
            _ => None,
        },
        SuggestionEvent::DocumentMacroEvent(event) => match &event.event().event {
            DocumentTopicEvent::Deleted(deleted) => Some(ResolutionEvent::Deleted {
                item: item(EntityType::Document, deleted.document_id.clone()),
                part: None,
            }),
            DocumentTopicEvent::Purged(purged) => Some(ResolutionEvent::Deleted {
                item: item(EntityType::Document, purged.document_id.clone()),
                part: None,
            }),
            DocumentTopicEvent::Updated(updated) if updated.share_permission_updated => {
                Some(ResolutionEvent::AccessChanged {
                    item: item(EntityType::Document, updated.document_id.clone()),
                    users: None,
                })
            }
            _ => None,
        },
        SuggestionEvent::ProjectMacroEvent(event) => match &event.event().event {
            ProjectTopicEvent::Deleted(deleted) => Some(ResolutionEvent::Deleted {
                item: item(EntityType::Project, deleted.project_id.clone()),
                part: None,
            }),
            ProjectTopicEvent::PermanentlyDeleted(deleted) => Some(ResolutionEvent::Deleted {
                item: item(EntityType::Project, deleted.project_id.clone()),
                part: None,
            }),
            _ => None,
        },
    }
}

async fn resolve_with_retry(
    resolver: &impl ResolveSuggestions,
    event: &ResolutionEvent,
    base_delay: Duration,
) {
    for attempt in 1..=MAX_ATTEMPTS {
        if attempt > 1 {
            tokio::time::sleep(base_delay * (1 << (attempt - 2))).await;
        }
        match resolver.resolve(event).await {
            Ok(_) => return,
            // The `suggestions.resolve` span records the error.
            Err(_) => tracing::warn!(attempt, "resolving suggestions failed"),
        }
    }
    tracing::error!(
        outcome = "dropped",
        "resolving suggestions kept failing; record skipped"
    );
}

async fn process_message<C: CommittingConsumer>(
    consumer: &C,
    resolver: &impl ResolveSuggestions,
    message: &MessageWrapper<C::MessageType<'_>, SuggestionEvent>,
    base_delay: Duration,
) -> Result<(), Report> {
    match message.decode_payload() {
        Ok(event) => {
            if let Some(event) = resolution_event(&event) {
                resolve_with_retry(resolver, &event, base_delay).await;
            }
        }
        Err(_) => {
            // Serde errors can carry payload strings; log only the outcome.
            tracing::warn!(outcome = "undecodable", "broker record skipped");
        }
    }
    consumer
        .commit(message.inner())
        .map_err(|_| rootcause::report!("suggestions offset commit failed"))
}

async fn consume<C>(
    consumer: C,
    resolver: impl ResolveSuggestions,
    shutdown: impl Future<Output = ()> + Send,
    base_delay: Duration,
) -> Result<(), Report>
where
    C: CommittingConsumer,
    for<'a> C::MessageType<'a>: Message,
{
    let consumer = MacroEventConsumerService::new(consumer);
    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        let message = tokio::select! {
            biased;
            _ = &mut shutdown => return Ok(()),
            result = consumer.recv() => {
                result.map_err(|_| rootcause::report!("suggestions consumer receive failed"))?
            }
        };
        let span =
            kafka_util::consumer_span(message.inner(), SuggestionResolutionGroup::GROUP_NAME);
        tokio::select! {
            biased;
            // Uncommitted: the record is redelivered, and resolving again is
            // a no-op.
            _ = &mut shutdown => return Ok(()),
            result = process_message(consumer.inner(), &resolver, &message, base_delay)
                .instrument(span.clone()) => {
                result.inspect_err(|error| kafka_util::record_span_error(&span, error))?;
            }
        }
    }
}

/// Resolve suggestions from the declared topics under their own consumer group,
/// until `shutdown`. Receive and commit failures end it; restart it with a
/// fresh consumer.
pub async fn run_suggestion_resolution_consumer(
    brokers: &str,
    resolver: impl ResolveSuggestions,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), Report> {
    let consumer = KafkaEventConsumer::<SuggestionResolutionGroup>::from_env(brokers)?;
    let consumer = KafkaConsumerAdapter::<SuggestionResolutionGroup, ()>::new(consumer)
        .subscribe::<SuggestionEvent>()?;
    tracing::info!(
        topics = ?SuggestionEvent::topics(),
        group = SuggestionResolutionGroup::GROUP_NAME,
        "suggestions resolution consumer listening"
    );
    consume(consumer, resolver, shutdown, RETRY_BASE_DELAY).await
}
