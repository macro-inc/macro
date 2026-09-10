//! Kafka consumer turning agent-session lifecycle facts into notifications.
//!
//! Subscribes to `macro.agent_session_lifecycle` under its own consumer group
//! and runs [`plan`] on every fact. Delivery is at-least-once: an offset is
//! committed only once every action the fact warranted has been accepted by
//! the notification service. That is safe to repeat - notification ids are
//! derived from the fact, so creating twice is a no-op and marking done
//! twice is idempotent - which is why a persistent failure exits *without*
//! committing and lets the supervising restart loop redeliver.
//!
//! Undecodable records are logged and skipped rather than wedging the
//! partition. The transport mirrors the webhook consumer's: plaintext for
//! `ENVIRONMENT=local`, TLS + SASL/OAUTHBEARER with MSK IAM otherwise.

use std::future::Future;
use std::time::Duration;

use anyhow::Context as _;
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _, MacroEventConsumerService,
};
use notification::domain::models::request::{NotificationStatus, UpdateNotificationsRequest};
use notification::domain::service::{NotificationIngress, NotificationReader};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message};
use tokio_retry::{Retry, strategy::ExponentialBackoff};

use crate::domain::plan::{Action, plan};
use crate::topics::DeclaredMacroEvent;

/// Consumer group for agent-session notifications. Offsets are committed
/// under this group, so restarts resume where the previous run left off.
struct AgentSessionNotificationsGroup;

impl GroupName for AgentSessionNotificationsGroup {
    const GROUP_NAME: &'static str = "notification-agent-session-lifecycle";
}

type Adapter = KafkaConsumerAdapter<AgentSessionNotificationsGroup, DeclaredMacroEvent>;
type Consumer = MacroEventConsumerService<DeclaredMacroEvent, Adapter>;

/// In-process attempts per fact before the consumer bails out and lets a
/// restart redeliver from the last committed offset.
const MAX_ATTEMPTS: usize = 5;

/// Delay before the first retry; doubles on each subsequent retry. The
/// worst case (1+2+4+8 = 15s) stays well under librdkafka's default
/// `max.poll.interval.ms` (300s), so retrying never evicts this consumer
/// from its group.
fn retry_strategy() -> impl Iterator<Item = Duration> {
    ExponentialBackoff::from_millis(2)
        .factor(500)
        .take(MAX_ATTEMPTS - 1)
}

/// Run every action one fact warranted, in order, against the notification
/// service. Every action is idempotent, so a partial failure is simply
/// retried from the top.
async fn apply<Ingress, Reader>(
    ingress: &Ingress,
    reader: &Reader,
    actions: &[Action],
) -> anyhow::Result<()>
where
    Ingress: NotificationIngress,
    Reader: NotificationReader,
{
    for action in actions {
        match action.clone() {
            Action::Settled(notify) => {
                ingress
                    .send_notification(notify.into_request())
                    .await
                    .map_err(|error| anyhow::anyhow!("{error:?}"))
                    .context("agent_session_settled")?;
            }
            Action::WaitingForInput(notify) => {
                ingress
                    .send_notification(notify.into_request())
                    .await
                    .map_err(|error| anyhow::anyhow!("{error:?}"))
                    .context("agent_session_waiting_for_input")?;
            }
            Action::Mentioned(notify) => {
                ingress
                    .send_notification(notify.into_request())
                    .await
                    .map_err(|error| anyhow::anyhow!("{error:?}"))
                    .context("agent_session_mentioned")?;
            }
            Action::MarkDone {
                user,
                notification_id,
            } => {
                reader
                    .update_notifications(UpdateNotificationsRequest {
                        user_id: user,
                        notification_ids: &[notification_id],
                        status: NotificationStatus::Done(true),
                    })
                    .await
                    .map_err(|error| anyhow::anyhow!("{error:?}"))
                    .context("mark an agent session notification done")?;
            }
        }
    }
    Ok(())
}

async fn apply_with_retry<Ingress, Reader>(
    ingress: &Ingress,
    reader: &Reader,
    actions: &[Action],
    partition: i32,
    offset: i64,
) -> anyhow::Result<()>
where
    Ingress: NotificationIngress,
    Reader: NotificationReader,
{
    let mut attempt = 0usize;
    Retry::start(retry_strategy(), || {
        attempt += 1;
        async move {
            let result = apply(ingress, reader, actions).await;
            if let Err(error) = &result
                && attempt < MAX_ATTEMPTS
            {
                tracing::warn!(
                    error = ?error,
                    partition,
                    offset,
                    attempt,
                    "agent session notification actions failed, retrying"
                );
            }
            result
        }
    })
    .await
    .with_context(|| {
        format!(
            "agent session notification actions failed after {MAX_ATTEMPTS} attempts \
             (partition {partition} offset {offset})"
        )
    })
}

fn commit_logged(consumer: &Consumer, message: &BorrowedMessage<'_>) {
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

/// Consume lifecycle facts until `shutdown` resolves, notifying through
/// `ingress` and retracting through `reader`.
///
/// Returns an error when the consumer cannot be created or subscribed, or
/// when a fact's actions keep failing; callers should treat that as fatal and
/// restart, which redelivers the uncommitted fact. Pass
/// `std::future::pending()` as `shutdown` to run until the process exits.
pub async fn run_agent_session_notification_consumer<Ingress, Reader>(
    brokers: &str,
    ingress: &Ingress,
    reader: &Reader,
    shutdown: impl Future<Output = ()> + Send,
) -> anyhow::Result<()>
where
    Ingress: NotificationIngress,
    Reader: NotificationReader,
{
    let consumer = KafkaEventConsumer::<AgentSessionNotificationsGroup>::from_env(brokers)?;
    let consumer = KafkaConsumerAdapter::<AgentSessionNotificationsGroup, ()>::new(consumer)
        .subscribe::<DeclaredMacroEvent>()
        .map_err(|error| {
            anyhow::anyhow!("failed to subscribe to the agent session lifecycle topic: {error:?}")
        })?;
    let consumer = Consumer::new(consumer);
    tracing::info!(
        topics = ?DeclaredMacroEvent::topics(),
        group = AgentSessionNotificationsGroup::GROUP_NAME,
        "agent session notification consumer listening"
    );

    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                tracing::info!("agent session notification consumer shutting down");
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
                match message.decode_payload() {
                    Ok(DeclaredMacroEvent::AgentSessionLifecycleMacroEvent(event)) => {
                        let actions = plan(&event.event().event);
                        tracing::debug!(
                            event = event.event().event.name(),
                            actions = actions.len(),
                            partition = kafka_message.partition(),
                            offset = kafka_message.offset(),
                            "planned agent session notifications"
                        );
                        apply_with_retry(
                            ingress,
                            reader,
                            &actions,
                            kafka_message.partition(),
                            kafka_message.offset(),
                        )
                        .await?;
                    }
                    Err(error) => tracing::error!(
                        error = ?error,
                        topic = kafka_message.topic(),
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                        "failed to decode an agent session lifecycle event"
                    ),
                }
                commit_logged(&consumer, kafka_message);
            }
        }
    }

    Ok(())
}
