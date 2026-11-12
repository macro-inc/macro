//! Kafka consumer fanning out `user.picture_changed` to the user's contacts.
//!
//! Subscribes to `macro.users` under the `contacts-user-picture` consumer
//! group. Realtime fan-out is best-effort: a user whose fan-out still fails
//! after [`MAX_ATTEMPTS`] is logged and skipped, and undecodable records are
//! logged and skipped, so neither wedges a partition. Offsets are committed
//! only after the batch was handled; shutting down mid-batch leaves it
//! uncommitted and it replays on restart (re-notifying is harmless).
//!
//! Bursts are coalesced: after the first record the consumer keeps reading for
//! up to [`BATCH_WINDOW`] (at most [`MAX_BATCH`] records), then fans out once
//! per distinct user in the batch.

#[cfg(test)]
mod test;

use crate::domain::{
    ports::{ContactsPageRepository, UserPictureNotifier},
    service::picture_fanout::{UserPictureFanout, coalesce_users},
};
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _, MacroEventConsumerService,
};
use macro_user_id::user_id::MacroUserIdStr;
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use tracing::Instrument as _;
use user_events::{UserMacroEvent, UserTopicEvent};

/// Consumer group for contact picture fan-out.
struct UserPictureConsumerGroup;

impl GroupName for UserPictureConsumerGroup {
    const GROUP_NAME: &'static str = "contacts-user-picture";
}

type UserPictureKafkaAdapter = KafkaConsumerAdapter<UserPictureConsumerGroup, DeclaredMacroEvent>;
type UserPictureKafkaConsumer =
    MacroEventConsumerService<DeclaredMacroEvent, UserPictureKafkaAdapter>;

macro_event_broker::declare_topics!(DeclaredMacroEvent: UserMacroEvent);

/// How long a batch keeps collecting records after its first one.
const BATCH_WINDOW: Duration = Duration::from_millis(250);

/// Most records one batch holds.
const MAX_BATCH: usize = 100;

/// Attempts per user before the fan-out is logged and skipped.
const MAX_ATTEMPTS: u32 = 3;

/// Delay before the first retry; it doubles with each attempt.
const RETRY_BASE_DELAY: Duration = Duration::from_secs(1);

/// The user a `macro.users` event asks to fan out, if any.
pub(crate) fn picture_changed_user(event: &UserTopicEvent) -> Option<MacroUserIdStr<'static>> {
    match event {
        UserTopicEvent::PictureChanged(metadata) => Some(metadata.user_id.clone()),
    }
}

fn commit_logged(consumer: &UserPictureKafkaConsumer, message: &BorrowedMessage<'_>) {
    if let Err(error) = consumer.inner().commit_message(message, CommitMode::Async) {
        tracing::error!(
            error = ?error,
            partition = message.partition(),
            offset = message.offset(),
            "failed to commit offset"
        );
    }
}

async fn fan_out_with_retries<R, N>(
    fanout: &UserPictureFanout<R, N>,
    user: &MacroUserIdStr<'static>,
) where
    R: ContactsPageRepository,
    N: UserPictureNotifier,
{
    let mut delay = RETRY_BASE_DELAY;
    for attempt in 1..=MAX_ATTEMPTS {
        if fanout.fan_out(user).await.is_ok() {
            return;
        }
        if attempt == MAX_ATTEMPTS {
            tracing::error!(user_id = %user.as_ref(), attempts = MAX_ATTEMPTS, "giving up user picture fan-out");
            return;
        }
        tokio::time::sleep(delay).await;
        delay *= 2;
    }
}

/// Run the picture fan-out consumer until `shutdown` resolves.
///
/// Callers should restart on error. Pass `std::future::pending()` as
/// `shutdown` to run until the process exits.
pub async fn run_user_picture_consumer<R, N>(
    brokers: &str,
    deps: Arc<UserPictureFanout<R, N>>,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), rootcause::Report>
where
    R: ContactsPageRepository,
    N: UserPictureNotifier,
{
    let consumer = KafkaEventConsumer::<UserPictureConsumerGroup>::from_env(brokers)?;
    let consumer = KafkaConsumerAdapter::<UserPictureConsumerGroup, ()>::new(consumer)
        .subscribe::<DeclaredMacroEvent>()
        .map_err(|error| rootcause::report!("failed to subscribe to user events: {error:?}"))?;
    let consumer = UserPictureKafkaConsumer::new(consumer);
    tracing::info!(
        topics = ?DeclaredMacroEvent::topics(),
        group = UserPictureConsumerGroup::GROUP_NAME,
        "user picture consumer listening"
    );

    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        let first = tokio::select! {
            _ = &mut shutdown => {
                tracing::info!("user picture consumer shutting down");
                break;
            }
            result = consumer.recv() => result,
        };
        let mut messages = Vec::new();
        match first {
            Ok(message) => messages.push(message),
            Err(error) => {
                tracing::error!(error = ?error, "kafka receive error");
                continue;
            }
        }
        let deadline = tokio::time::Instant::now() + BATCH_WINDOW;
        while messages.len() < MAX_BATCH {
            match tokio::time::timeout_at(deadline, consumer.recv()).await {
                Ok(Ok(message)) => messages.push(message),
                Ok(Err(error)) => tracing::error!(error = ?error, "kafka receive error"),
                Err(_) => break,
            }
        }

        // Latest record per user wins: its span parents the fan-out.
        let mut latest = Vec::new();
        for message in &messages {
            let kafka_message = message.inner();
            let span =
                kafka_util::consumer_span(kafka_message, UserPictureConsumerGroup::GROUP_NAME);
            match message.decode_payload() {
                Ok(DeclaredMacroEvent::UserMacroEvent(event)) => {
                    if let Some(user) = picture_changed_user(&event.event().event) {
                        latest.push((user, span));
                    }
                }
                Err(error) => tracing::error!(
                    parent: &span,
                    error = ?error,
                    topic = kafka_message.topic(),
                    partition = kafka_message.partition(),
                    offset = kafka_message.offset(),
                    "failed to decode user event"
                ),
            }
        }
        let users = coalesce_users(latest.iter().map(|(user, _)| user.clone()));
        let work = async {
            for user in &users {
                let span = latest
                    .iter()
                    .rev()
                    .find(|(candidate, _)| candidate == user)
                    .map(|(_, span)| span.clone())
                    .unwrap_or_else(tracing::Span::none);
                fan_out_with_retries(&*deps, user).instrument(span).await;
            }
        };
        tokio::select! {
            _ = &mut shutdown => {
                tracing::info!("user picture consumer shutting down mid-batch");
                break;
            }
            () = work => {}
        }
        for message in &messages {
            commit_logged(&consumer, message.inner());
        }
    }

    Ok(())
}
