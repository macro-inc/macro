//! A channel's mentions-only preference, from the stored preference through
//! ingress to the delivery queue: which recipients get the in-app (web)
//! notification and which get the mobile push.

use super::*;
use crate::domain::{
    item_preferences::ItemNotificationPreferenceService,
    models::{
        NotificationExtIos,
        apple::APNSPushNotification,
        email_notification_digest::{BulkDigestStateMachine, StateMachineDecisionA},
        mobile::NotifCollapseKey,
        queue_message::{QueueMessage, RawQueueMessage},
    },
    ports::NotificationQueue,
    service::{NotificationIngress, NotificationIngressService},
};
use crate::outbound::item_preferences::PgItemNotificationPreferenceRepository;
use std::sync::{Arc, Mutex};

const CHANNEL_ID: &str = "channel-one";

/// The three notifications a channel message can produce, under the event
/// types the channels crate sends them with.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChannelMessageSend;
impl Notification for ChannelMessageSend {
    const TYPE_NAME: &'static str = "channel_message_send";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChannelMessageReply;
impl Notification for ChannelMessageReply {
    const TYPE_NAME: &'static str = "channel_message_reply";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChannelMention;
impl Notification for ChannelMention {
    const TYPE_NAME: &'static str = "channel_mention";
}

macro_rules! push_capable {
    ($notification:ty) => {
        impl NotificationExtIos for $notification {
            type NotifData = $notification;

            fn collapse_key(&self, _entity: &model_entity::Entity<'_>) -> NotifCollapseKey {
                NotifCollapseKey::new(CHANNEL_ID)
            }

            fn as_apns<'a>(
                &self,
                _sender: Option<MacroUserIdStr<'a>>,
                _entity: &model_entity::Entity<'_>,
                _notification_id: Uuid,
            ) -> Option<APNSPushNotification<Self::NotifData>> {
                Some(APNSPushNotification {
                    aps: Default::default(),
                    push_notification_data: self.clone(),
                })
            }
        }
    };
}
push_capable!(ChannelMessageSend);
push_capable!(ChannelMessageReply);
push_capable!(ChannelMention);

#[derive(Default)]
struct RecordingQueue {
    published: Mutex<Vec<serde_json::Value>>,
}

impl NotificationQueue for Arc<RecordingQueue> {
    async fn publish<'a, T: Serialize + Send + Sync, U: Serialize + Send + Sync>(
        &self,
        messages: Vec<QueueMessage<'a, T, U>>,
    ) -> Result<(), Report> {
        self.published.lock().unwrap().extend(
            messages
                .into_iter()
                .map(|message| serde_json::to_value(message).unwrap()),
        );
        Ok(())
    }

    async fn receive_messages(&self) -> Result<Vec<RawQueueMessage>, Report> {
        Ok(Vec::new())
    }

    async fn delete_message(&self, _receipt_handle: &str) -> Result<(), Report> {
        Ok(())
    }
}

struct NoDigest;
impl BulkDigestStateMachine for NoDigest {
    async fn ingest<T: Serialize + Send + Sync + 'static>(
        &self,
        _notification: UserNotificationRow<Arc<T>>,
    ) -> Result<StateMachineDecisionA, Report> {
        Err(rootcause::report!(
            "digest delivery is not used in this test"
        ))
    }
}

/// Who a sent notification was queued for, per delivery channel.
#[derive(Debug, PartialEq)]
struct Delivered {
    /// Recipients of the connection-gateway message the web app shows.
    web: Vec<String>,
    /// Recipients whose devices the mobile push message targets.
    push: Vec<String>,
}

/// Send one channel notification from carol to `recipients` the way the
/// channels crate does (push and connection gateway), and read back who the
/// delivery queue was asked to reach.
async fn deliver<T: Notification + NotificationExtIos + Clone>(
    pool: &Pool<Postgres>,
    notification: T,
    recipients: [&MacroUserIdStr<'static>; 2],
) -> Delivered
where
    T::NotifData: Serialize + Send + Sync + 'static,
{
    let queue = Arc::new(RecordingQueue::default());
    let service = NotificationIngressService::new(
        DbNotificationRepository::new(pool.clone()),
        queue.clone(),
        NoDigest,
    );

    service
        .send_notification(
            SendNotificationRequestBuilder {
                notification_entity: EntityType::Channel.with_entity_str(CHANNEL_ID),
                secondary_notification_entity: None,
                notification,
                sender_id: Some(test_user("carol@example.com")),
                recipient_ids: recipients.into_iter().cloned().collect(),
            }
            .into_request()
            .with_apns()
            .with_conn_gateway(),
        )
        .await
        .unwrap();

    let mut delivered = Delivered {
        web: Vec::new(),
        push: Vec::new(),
    };
    for message in queue.published.lock().unwrap().iter() {
        if let Some(recipients) = message["content"]["ConnGateway"]["recipients"].as_array() {
            delivered.web.extend(
                recipients
                    .iter()
                    .map(|recipient| recipient.as_str().unwrap().to_owned()),
            );
        }
        if let Some(endpoints) = message["content"]["Ios"]["ios_device_endpoints"].as_object() {
            delivered.push.extend(endpoints.keys().cloned());
        }
    }
    delivered.web.sort();
    delivered.push.sort();
    delivered
}

fn both() -> Delivered {
    Delivered {
        web: vec![
            "macro|alice@example.com".into(),
            "macro|bob@example.com".into(),
        ],
        push: vec![
            "macro|alice@example.com".into(),
            "macro|bob@example.com".into(),
        ],
    }
}

fn only(user: &str) -> Delivered {
    Delivered {
        web: vec![user.into()],
        push: vec![user.into()],
    }
}

fn nobody() -> Delivered {
    Delivered {
        web: Vec::new(),
        push: Vec::new(),
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("channel_recipient_devices"))
)]
async fn mentions_only_delivers_web_and_push_for_direct_mentions_alone(pool: Pool<Postgres>) {
    let alice = test_user("alice@example.com");
    let bob = test_user("bob@example.com");
    let preferences = ItemNotificationPreferenceService::new(
        PgItemNotificationPreferenceRepository(pool.clone()),
    );
    let channel = || EntityType::Channel.with_entity_str(CHANNEL_ID);

    // Option off: every kind of channel notification reaches both people.
    assert_eq!(
        deliver(&pool, ChannelMessageSend, [&alice, &bob]).await,
        both()
    );
    assert_eq!(
        deliver(&pool, ChannelMessageReply, [&alice, &bob]).await,
        both()
    );
    assert_eq!(deliver(&pool, ChannelMention, [&alice, &bob]).await, both());

    // Alice turns the option on for this channel.
    preferences
        .set_mentions_only(alice.copied(), channel())
        .await
        .unwrap();

    // A message or a thread reply that doesn't mention her reaches only Bob,
    // on neither of her channels.
    assert_eq!(
        deliver(&pool, ChannelMessageSend, [&alice, &bob]).await,
        only("macro|bob@example.com")
    );
    assert_eq!(
        deliver(&pool, ChannelMessageReply, [&alice, &bob]).await,
        only("macro|bob@example.com")
    );

    // A direct @mention still reaches her on both.
    assert_eq!(deliver(&pool, ChannelMention, [&alice, &bob]).await, both());

    // The option is per channel: her other channels are untouched.
    let other_service = NotificationIngressService::new(
        DbNotificationRepository::new(pool.clone()),
        Arc::new(RecordingQueue::default()),
        NoDigest,
    );
    let other_channel = other_service
        .send_notification(
            SendNotificationRequestBuilder {
                notification_entity: EntityType::Channel.with_entity_str("channel-two"),
                secondary_notification_entity: None,
                notification: ChannelMessageSend,
                sender_id: Some(test_user("carol@example.com")),
                recipient_ids: HashSet::from([alice.clone()]),
            }
            .into_request()
            .with_conn_gateway(),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        other_channel.notified_recipients,
        HashSet::from([alice.clone()])
    );

    // A full mute replaces the option and silences mentions too, as before.
    preferences
        .set(alice.copied(), channel(), None, chrono::Utc::now())
        .await
        .unwrap();
    assert_eq!(
        deliver(&pool, ChannelMention, [&alice, &bob]).await,
        only("macro|bob@example.com")
    );

    // Turning the option back on, then off, restores everything.
    preferences
        .set_mentions_only(alice.copied(), channel())
        .await
        .unwrap();
    assert_eq!(deliver(&pool, ChannelMention, [&alice, &bob]).await, both());
    preferences.remove(alice.copied(), channel()).await.unwrap();
    assert_eq!(
        deliver(&pool, ChannelMessageSend, [&alice, &bob]).await,
        both()
    );
    assert_eq!(
        deliver(&pool, ChannelMessageReply, [&alice, &bob]).await,
        both()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("channel_recipient_devices"))
)]
async fn mentions_only_recipient_alone_gets_nothing_queued(pool: Pool<Postgres>) {
    let alice = test_user("alice@example.com");
    let bob = test_user("bob@example.com");
    let preferences = ItemNotificationPreferenceService::new(
        PgItemNotificationPreferenceRepository(pool.clone()),
    );
    for user in [&alice, &bob] {
        preferences
            .set_mentions_only(
                user.copied(),
                EntityType::Channel.with_entity_str(CHANNEL_ID),
            )
            .await
            .unwrap();
    }

    assert_eq!(
        deliver(&pool, ChannelMessageSend, [&alice, &bob]).await,
        nobody()
    );
    let unseen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_notification WHERE event_item_id = 'channel-one'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(unseen, 0, "no notification row means no unread badge");
}
