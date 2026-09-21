//! Unit tests for the notification services.

use crate::domain::models::apple::APNSPushNotification;
use crate::domain::models::delivery_outbox::{
    ClaimedDeliveryIntent, ClaimedDeliveryRequest, ClaimedDigestReceiptCleanup, DeliveryClaimToken,
    DeliveryLease,
};
use crate::domain::models::device::DeviceType;
use crate::domain::models::email_notification_digest::BulkDigestStateMachine;
use crate::domain::models::email_notification_digest::ports::DigestBatch;
use crate::domain::models::email_notification_digest::ports::{ClaimResult, DigestBatcher};
use crate::domain::models::mobile::NotifCollapseKey;
use crate::domain::models::queue_message::{
    ConnGatewayNotification, EmailContent, EmailCreateBundle, NotificationChannel, QueueMessage,
    RawQueueMessage, RealtimeNotif,
};
use crate::domain::models::request::{
    NotificationStatus, UpdateNotificationsForEntitiesRequest, UpdateNotificationsRequest,
};
use crate::domain::models::{
    DeviceEndpoint, Notification, NotificationExtEmail, NotificationExtIos,
    NotificationIdAndCollapseKey, RateLimitConfig, RateLimitExceeded, RateLimitKey,
    RateLimitResult, SendNotificationRequest, SendNotificationRequestBuilder, TaggedContent,
    UserNotificationRow,
};
use crate::domain::ports::{
    EmailSender, NotificationDeliveryRepository, NotificationEgress, NotificationQueue,
    NotificationRepository, NotificationSender, RealtimeSender, SnsEndpointManager,
};
use crate::domain::service::{
    NotificationEgressService, NotificationIngress, NotificationIngressService, NotificationReader,
    NotificationReaderService, PlatformArnConfig,
};
use crate::outbound::repository::DbNotificationRepository;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use rate_limit::domain::models::RateLimitOk;
use rootcause::{Report, report};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use uuid::Uuid;

/// A test notification type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct TestNotification {
    message: String,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "tag", content = "content", rename_all = "snake_case")]
enum TestNotifEvent {
    TestNotification(TestNotification),
}

impl Notification for TestNotification {
    const TYPE_NAME: &'static str = "test_notification";
}

impl NotificationExtIos for TestNotification {
    type NotifData = TestNotification;

    fn collapse_key(&self, _entity: &model_entity::Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new("test")
    }

    fn as_apns<'a>(
        &self,
        _sender: Option<MacroUserIdStr<'a>>,
        _entity: &model_entity::Entity<'_>,
        _notification_id: uuid::Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        Some(APNSPushNotification {
            aps: Default::default(),
            push_notification_data: self.clone(),
        })
    }
}

impl NotificationExtEmail for TestNotification {
    fn format_email(&self) -> crate::domain::models::queue_message::EmailContent {
        EmailContent {
            subject: "Test".to_string(),
            body: self.message.clone(),
        }
    }

    fn rate_limit_config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: u64::MAX,
            window: Duration::from_hours(1),
        }
    }

    fn rate_limit_key(&self) -> RateLimitKey {
        RateLimitKey::from_str_hashed(&"test-key")
    }
}

/// Helper to create a test user ID.
fn test_user_id(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

fn conn_request(
    notification_id: Uuid,
    recipient: MacroUserIdStr<'static>,
) -> SendNotificationRequest<'static, TestNotification, ()> {
    SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_string("delivery-test".to_string()),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "durable delivery".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([recipient]),
    }
    .into_request_with_id(notification_id)
    .with_conn_gateway()
}

/// Mock repository that tracks calls.
struct MockRepository {
    muted_users: HashSet<MacroUserIdStr<'static>>,
    unsubscribed_users: HashSet<MacroUserIdStr<'static>>,
    type_disabled_users: HashSet<MacroUserIdStr<'static>>,
    device_endpoints: HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>,
    created_notifications: Mutex<Vec<Uuid>>,
    stored_collapse_keys: Mutex<Vec<(Uuid, Option<String>)>>,
    basic_notifications: Vec<NotificationIdAndCollapseKey>,
    digest_eligible_notification_ids: Option<HashSet<Uuid>>,
    entity_notifications: HashMap<Entity<'static>, Vec<UserNotificationRow<serde_json::Value>>>,
    entity_notification_ids: Vec<Uuid>,
    updated_notifications: Option<Vec<UserNotificationRow<serde_json::Value>>>,
    entity_lookup_calls: Mutex<Vec<(String, Vec<(EntityType, String)>)>>,
    mark_seen_calls: Mutex<Vec<(String, Vec<Uuid>)>>,
    mark_done_calls: Mutex<Vec<(String, Vec<Uuid>, bool)>>,
    delivery_requests: Mutex<HashMap<Uuid, MockDeliveryRequest>>,
    delivery_intents: Mutex<HashMap<(Uuid, i32), MockDeliveryIntent>>,
    prepare_failures_remaining: AtomicUsize,
    intent_completion_failures_remaining: AtomicUsize,
    intent_completion_errors_remaining: AtomicUsize,
    intent_release_failures_remaining: AtomicUsize,
}

#[derive(Clone)]
struct MockDeliveryRequest {
    generation: Uuid,
    request: serde_json::Value,
    notifications: Vec<UserNotificationRow<serde_json::Value>>,
    prepared: bool,
    completed: bool,
    claim_token: Option<DeliveryClaimToken>,
    attempt_count: i32,
    created_at: chrono::DateTime<Utc>,
}

#[derive(Clone)]
struct MockDeliveryIntent {
    payload: serde_json::Value,
    published: bool,
    claim_token: Option<DeliveryClaimToken>,
    attempt_count: i32,
    created_at: chrono::DateTime<Utc>,
}

impl MockRepository {
    fn new() -> Self {
        Self {
            muted_users: HashSet::new(),
            unsubscribed_users: HashSet::new(),
            type_disabled_users: HashSet::new(),
            device_endpoints: HashMap::new(),
            created_notifications: Mutex::new(Vec::new()),
            stored_collapse_keys: Mutex::new(Vec::new()),
            basic_notifications: Vec::new(),
            digest_eligible_notification_ids: None,
            entity_notifications: HashMap::new(),
            entity_notification_ids: Vec::new(),
            updated_notifications: None,
            entity_lookup_calls: Mutex::new(Vec::new()),
            mark_seen_calls: Mutex::new(Vec::new()),
            mark_done_calls: Mutex::new(Vec::new()),
            delivery_requests: Mutex::new(HashMap::new()),
            delivery_intents: Mutex::new(HashMap::new()),
            prepare_failures_remaining: AtomicUsize::new(0),
            intent_completion_failures_remaining: AtomicUsize::new(0),
            intent_completion_errors_remaining: AtomicUsize::new(0),
            intent_release_failures_remaining: AtomicUsize::new(0),
        }
    }

    fn with_basic_notification(mut self, id: Uuid, collapse_key: String) -> Self {
        self.basic_notifications.push(NotificationIdAndCollapseKey {
            id,
            apns_collapse_key: collapse_key,
        });
        self
    }

    fn with_digest_eligible_notification_ids(
        mut self,
        ids: impl IntoIterator<Item = Uuid>,
    ) -> Self {
        self.digest_eligible_notification_ids = Some(ids.into_iter().collect());
        self
    }

    fn with_entity_notifications(
        mut self,
        entity: Entity<'static>,
        notifications: Vec<UserNotificationRow<serde_json::Value>>,
    ) -> Self {
        self.entity_notifications.insert(entity, notifications);
        self
    }

    fn with_entity_notification_ids(mut self, notification_ids: Vec<Uuid>) -> Self {
        self.entity_notification_ids = notification_ids;
        self
    }

    fn with_updated_notifications(
        mut self,
        notifications: Vec<UserNotificationRow<serde_json::Value>>,
    ) -> Self {
        self.updated_notifications = Some(notifications);
        self
    }

    fn with_muted_user(mut self, user_id: MacroUserIdStr<'static>) -> Self {
        self.muted_users.insert(user_id);
        self
    }

    fn with_unsubscribed_user(mut self, user_id: MacroUserIdStr<'static>) -> Self {
        self.unsubscribed_users.insert(user_id);
        self
    }

    fn with_type_disabled_user(mut self, user_id: MacroUserIdStr<'static>) -> Self {
        self.type_disabled_users.insert(user_id);
        self
    }

    fn with_device_endpoint(
        mut self,
        user_id: MacroUserIdStr<'static>,
        endpoint: DeviceEndpoint,
    ) -> Self {
        self.device_endpoints
            .entry(user_id)
            .or_default()
            .push(endpoint);
        self
    }

    fn with_prepare_failures(self, count: usize) -> Self {
        self.prepare_failures_remaining
            .store(count, Ordering::Relaxed);
        self
    }

    fn with_intent_completion_failures(self, count: usize) -> Self {
        self.intent_completion_failures_remaining
            .store(count, Ordering::Relaxed);
        self
    }
}

struct MockStateMachine;

impl BulkDigestStateMachine for MockStateMachine {
    async fn ingest<T: Serialize + Send + Sync + 'static>(
        &self,
        _notif: UserNotificationRow<Arc<T>>,
        _delivery_generation: Uuid,
    ) -> Result<crate::domain::models::email_notification_digest::StateMachineDecisionA, Report>
    {
        Ok(
            crate::domain::models::email_notification_digest::StateMachineDecisionA::DontSend(
                crate::domain::models::email_notification_digest::DontSend::new(),
            ),
        )
    }

    async fn cleanup_digest_receipt(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_id: Uuid,
        _delivery_generation: Uuid,
    ) -> Result<(), Report> {
        Ok(())
    }
}

struct ReplaySafeDigestStateMachine {
    ingest_attempts: AtomicUsize,
    delivery_generations: Mutex<Vec<Uuid>>,
}

impl ReplaySafeDigestStateMachine {
    fn new() -> Self {
        Self {
            ingest_attempts: AtomicUsize::new(0),
            delivery_generations: Mutex::new(Vec::new()),
        }
    }
}

impl BulkDigestStateMachine for Arc<ReplaySafeDigestStateMachine> {
    async fn ingest<T: Serialize + Send + Sync + 'static>(
        &self,
        _notification: UserNotificationRow<Arc<T>>,
        delivery_generation: Uuid,
    ) -> Result<crate::domain::models::email_notification_digest::StateMachineDecisionA, Report>
    {
        self.ingest_attempts.fetch_add(1, Ordering::Relaxed);
        self.delivery_generations
            .lock()
            .unwrap()
            .push(delivery_generation);
        Ok(
            crate::domain::models::email_notification_digest::StateMachineDecisionA::BatchWasQueued(
                crate::domain::models::email_notification_digest::BatchSend::from_inner(()),
            ),
        )
    }

    async fn cleanup_digest_receipt(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_id: Uuid,
        _delivery_generation: Uuid,
    ) -> Result<(), Report> {
        Ok(())
    }
}

struct FailingStateMachine;

impl BulkDigestStateMachine for FailingStateMachine {
    async fn ingest<T: Serialize + Send + Sync + 'static>(
        &self,
        _notification: UserNotificationRow<Arc<T>>,
        _delivery_generation: Uuid,
    ) -> Result<crate::domain::models::email_notification_digest::StateMachineDecisionA, Report>
    {
        Err(report!("injected transient state-machine failure"))
    }

    async fn cleanup_digest_receipt(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_id: Uuid,
        _delivery_generation: Uuid,
    ) -> Result<(), Report> {
        Ok(())
    }
}

#[cfg(feature = "redis-tests")]
struct RedisCleanupStateMachine {
    batcher: crate::outbound::digest_batcher::RedisDigestBatcher,
    failures_remaining: AtomicUsize,
}

#[cfg(feature = "redis-tests")]
impl BulkDigestStateMachine for RedisCleanupStateMachine {
    async fn ingest<T: Serialize + Send + Sync + 'static>(
        &self,
        _notification: UserNotificationRow<Arc<T>>,
        _delivery_generation: Uuid,
    ) -> Result<crate::domain::models::email_notification_digest::StateMachineDecisionA, Report>
    {
        Ok(
            crate::domain::models::email_notification_digest::StateMachineDecisionA::DontSend(
                crate::domain::models::email_notification_digest::DontSend::new(),
            ),
        )
    }

    async fn cleanup_digest_receipt(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
        delivery_generation: Uuid,
    ) -> Result<(), Report> {
        if self
            .failures_remaining
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                remaining.checked_sub(1)
            })
            .is_ok()
        {
            return Err(report!("injected Redis cleanup failure"));
        }
        self.batcher
            .remove_notification_receipt(user_id, notification_id, delivery_generation)
            .await
    }
}

fn updated_notification(
    user_id: MacroUserIdStr<'_>,
    notification_id: Uuid,
    done: bool,
    viewed_at: Option<chrono::DateTime<Utc>>,
    updated_at: chrono::DateTime<Utc>,
) -> UserNotificationRow<serde_json::Value> {
    UserNotificationRow {
        owner_id: user_id.into_owned(),
        notification_id,
        notification_event_type: "test_notification".to_string(),
        entity: EntityType::Document.with_entity_str("doc-1").into_owned(),
        sent: true,
        state: if done {
            crate::domain::models::NotificationState::Done
        } else {
            crate::domain::models::NotificationState::Seen
        },
        created_at: updated_at,
        viewed_at,
        updated_at,
        deleted_at: None,
        notification_metadata: json!({ "message": "updated notification" }),
        sender_id: None,
    }
}

impl NotificationRepository for MockRepository {
    async fn get_muted_users<'a>(
        &self,
        _user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        Ok(self.muted_users.clone())
    }

    async fn get_unsubscribed_users<'a>(
        &self,
        _item_id: &str,
        _user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        Ok(self.unsubscribed_users.clone())
    }

    async fn create_notification<'a, T: Serialize + Send + Sync>(
        &self,
        request: SendNotificationRequestBuilder<'a, TaggedContent<T>>,
        notification_id: Uuid,
        _service_sender: &str,
        apns_collapse_key: Option<&str>,
    ) -> Result<Option<Vec<UserNotificationRow<Arc<T>>>>, Report> {
        self.created_notifications
            .lock()
            .unwrap()
            .push(notification_id);
        self.stored_collapse_keys
            .lock()
            .unwrap()
            .push((notification_id, apns_collapse_key.map(String::from)));
        let entity = request.notification_entity.clone().into_owned();
        let sender_id = request.sender_id.as_ref().map(|id| id.clone().into_owned());
        let notification_metadata = Arc::new(request.notification.content);
        let rows = request
            .recipient_ids
            .iter()
            .map(|recipient| UserNotificationRow {
                owner_id: recipient.clone().into_owned(),
                notification_id,
                notification_event_type: request.notification.tag.as_ref().to_string(),
                entity: entity.clone(),
                sent: false,
                state: crate::domain::models::NotificationState::Unseen,
                created_at: Utc::now(),
                viewed_at: None,
                updated_at: Utc::now(),
                deleted_at: None,
                notification_metadata: notification_metadata.clone(),
                sender_id: sender_id.clone(),
            })
            .collect();
        Ok(Some(rows))
    }

    async fn update_sent_status<'a>(
        &self,
        _notification_id: Uuid,
        _user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn get_device_endpoints<'a>(
        &self,
        _user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>, Report> {
        Ok(self.device_endpoints.clone())
    }

    async fn mark_notifications_seen(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<Vec<UserNotificationRow<serde_json::Value>>, Report> {
        self.mark_seen_calls
            .lock()
            .unwrap()
            .push((user_id.to_string(), notification_ids.to_vec()));
        if let Some(notifications) = &self.updated_notifications {
            return Ok(notifications.clone());
        }
        let now = Utc::now();
        Ok(notification_ids
            .iter()
            .map(|id| updated_notification(user_id.clone(), *id, false, Some(now), now))
            .collect())
    }

    async fn mark_notifications_done(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
        done: bool,
    ) -> Result<Vec<UserNotificationRow<serde_json::Value>>, Report> {
        self.mark_done_calls.lock().unwrap().push((
            user_id.to_string(),
            notification_ids.to_vec(),
            done,
        ));
        if let Some(notifications) = &self.updated_notifications {
            return Ok(notifications.clone());
        }
        let now = Utc::now();
        Ok(notification_ids
            .iter()
            .map(|id| updated_notification(user_id.clone(), *id, done, None, now))
            .collect())
    }

    async fn get_notification_ids_for_entities(
        &self,
        user_id: MacroUserIdStr<'_>,
        entities: &[model_entity::Entity<'_>],
    ) -> Result<Vec<Uuid>, Report> {
        self.entity_lookup_calls.lock().unwrap().push((
            user_id.to_string(),
            entities
                .iter()
                .map(|entity| (entity.entity_type, entity.entity_id.to_string()))
                .collect(),
        ));
        Ok(self.entity_notification_ids.clone())
    }

    async fn get_basic_notifications(
        &self,
        _notification_ids: &[Uuid],
    ) -> Result<Vec<NotificationIdAndCollapseKey>, Report> {
        Ok(self.basic_notifications.clone())
    }

    async fn get_digest_eligible_notification_ids(
        &self,
        _user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<HashSet<Uuid>, Report> {
        Ok(self
            .digest_eligible_notification_ids
            .clone()
            .unwrap_or_else(|| notification_ids.iter().copied().collect()))
    }

    async fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _limit: u32,
        _cursor: models_pagination::Query<Uuid, models_pagination::CreatedAt, ()>,
        _filters: crate::domain::models::request::NotificationListFilters,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        Ok(vec![])
    }

    async fn get_user_notifications_by_event_item_ids<T: DeserializeOwned + Send>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _event_item_ids: &[Uuid],
        _limit: u32,
        _cursor: models_pagination::Query<Uuid, models_pagination::CreatedAt, ()>,
        _filters: crate::domain::models::request::NotificationListFilters,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        Ok(vec![])
    }

    async fn get_entity_notifications_batch(
        &self,
        _user_id: MacroUserIdStr<'_>,
        entities: Vec<Entity<'static>>,
    ) -> Result<HashMap<Entity<'static>, Vec<UserNotificationRow<serde_json::Value>>>, Report> {
        Ok(entities
            .into_iter()
            .map(|entity| {
                let notifications = self
                    .entity_notifications
                    .get(&entity)
                    .cloned()
                    .unwrap_or_default();
                (entity, notifications)
            })
            .collect())
    }

    async fn get_user_notification_by_id<T: DeserializeOwned + Send>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_id: Uuid,
    ) -> Result<Option<UserNotificationRow<T>>, Report> {
        Ok(None)
    }

    async fn delete_user_notification(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_id: Uuid,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn bulk_delete_user_notifications(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_ids: &[Uuid],
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn delete_all_user_notifications(
        &self,
        _user_id: MacroUserIdStr<'_>,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn get_device_endpoint(
        &self,
        _device_token: &str,
        _device_type: &DeviceType,
    ) -> Result<Option<String>, Report> {
        Ok(None)
    }

    async fn upsert_device(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _device_token: &str,
        _device_endpoint: &str,
        _device_type: &DeviceType,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn delete_user_devices_by_token(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _device_token: &str,
        _device_type: &DeviceType,
    ) -> Result<Vec<String>, Report> {
        Ok(Vec::new())
    }

    async fn delete_stale_devices_by_token(
        &self,
        _device_token: &str,
        _device_type: &DeviceType,
        _active_endpoint: &str,
    ) -> Result<Vec<String>, Report> {
        Ok(Vec::new())
    }

    async fn delete_device_by_endpoint(&self, _endpoint_arn: &str) -> Result<(), Report> {
        Ok(())
    }

    async fn get_users_with_type_disabled<'a>(
        &self,
        _notification_event_type: &str,
        _user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        Ok(self.type_disabled_users.clone())
    }

    async fn get_disabled_notification_types(
        &self,
        _user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<crate::domain::models::DisabledNotificationType>, Report> {
        Ok(vec![])
    }

    async fn disable_notification_type(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_event_type: &str,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn enable_notification_type(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_event_type: &str,
    ) -> Result<(), Report> {
        Ok(())
    }
}

impl NotificationDeliveryRepository for MockRepository {
    async fn restore_existing_delivery_request<
        'a,
        T: Serialize + Send + Sync,
        U: Serialize + Send + Sync,
    >(
        &self,
        request: &SendNotificationRequest<'a, T, U>,
    ) -> Result<Option<HashSet<MacroUserIdStr<'static>>>, Report> {
        Ok(self
            .delivery_requests
            .lock()
            .unwrap()
            .get(&request.uuid_to_write)
            .map(|existing| {
                existing
                    .notifications
                    .iter()
                    .map(|notification| notification.owner_id.clone())
                    .collect()
            }))
    }

    async fn persist_notification_with_delivery_request<
        'a,
        T: Serialize + DeserializeOwned + Send + Sync,
        U: Serialize + Send + Sync,
    >(
        &self,
        request: SendNotificationRequest<'a, T, U>,
        _service_sender: &str,
    ) -> Result<Vec<UserNotificationRow<Arc<T>>>, Report> {
        let notification_id = request.uuid_to_write;
        let mut requests = self.delivery_requests.lock().unwrap();
        if let Some(existing) = requests.get(&notification_id) {
            return existing
                .notifications
                .iter()
                .cloned()
                .map(|row| row.try_map(|value| serde_json::from_value(value).map(Arc::new)))
                .collect::<Result<Vec<_>, _>>()
                .map_err(Report::from);
        }

        self.created_notifications
            .lock()
            .unwrap()
            .push(notification_id);
        let collapse_key = request
            .build_apns
            .as_ref()
            .map(|output| output.attr.collapse_key.clone());
        self.stored_collapse_keys
            .lock()
            .unwrap()
            .push((notification_id, collapse_key));

        let now = Utc::now();
        let entity = request.req.notification_entity.clone().into_owned();
        let sender_id = request
            .req
            .sender_id
            .as_ref()
            .map(|id| id.clone().into_owned());
        let notification_event_type = request.req.notification.tag.as_ref().to_string();
        let metadata = serde_json::to_value(&request.req.notification.content)?;
        let raw_rows: Vec<_> = request
            .req
            .recipient_ids
            .iter()
            .map(|recipient| UserNotificationRow {
                owner_id: recipient.clone().into_owned(),
                notification_id,
                notification_event_type: notification_event_type.clone(),
                entity: entity.clone(),
                sent: false,
                state: crate::domain::models::NotificationState::Unseen,
                created_at: now,
                viewed_at: None,
                updated_at: now,
                deleted_at: None,
                notification_metadata: metadata.clone(),
                sender_id: sender_id.clone(),
            })
            .collect();
        let delivery_request = serde_json::to_value(&request)?;
        requests.insert(
            notification_id,
            MockDeliveryRequest {
                generation: Uuid::now_v7(),
                request: delivery_request,
                notifications: raw_rows.clone(),
                prepared: false,
                completed: false,
                claim_token: None,
                attempt_count: 0,
                created_at: now,
            },
        );

        raw_rows
            .into_iter()
            .map(|row| row.try_map(|value| serde_json::from_value(value).map(Arc::new)))
            .collect::<Result<Vec<_>, _>>()
            .map_err(Report::from)
    }

    async fn claim_delivery_request(
        &self,
        notification_id: Option<Uuid>,
        claim_token: DeliveryClaimToken,
        _lease: DeliveryLease,
    ) -> Result<Option<ClaimedDeliveryRequest>, Report> {
        let mut requests = self.delivery_requests.lock().unwrap();
        let entry = requests.iter_mut().find(|(id, request)| {
            notification_id.is_none_or(|notification_id| **id == notification_id)
                && !request.prepared
                && !request.completed
                && request.claim_token.is_none()
        });
        let Some((notification_id, request)) = entry else {
            return Ok(None);
        };
        request.claim_token = Some(claim_token);
        request.attempt_count += 1;
        Ok(Some(ClaimedDeliveryRequest {
            notification_id: *notification_id,
            generation: request.generation,
            claim_token,
            request: request.request.clone(),
            notifications: request.notifications.clone(),
            attempt_count: request.attempt_count,
            pending_since: request.created_at,
        }))
    }

    async fn prepare_delivery_intents(
        &self,
        notification_id: Uuid,
        claim_token: DeliveryClaimToken,
        payloads: &[serde_json::Value],
        _digest_receipt_cleanup_after: chrono::DateTime<Utc>,
    ) -> Result<bool, Report> {
        if self
            .prepare_failures_remaining
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                remaining.checked_sub(1)
            })
            .is_ok()
        {
            return Err(report!(
                "injected failure after state-machine ingest before intent persistence"
            ));
        }

        let mut requests = self.delivery_requests.lock().unwrap();
        let Some(request) = requests.get_mut(&notification_id) else {
            return Ok(false);
        };
        if request.claim_token != Some(claim_token) || request.prepared {
            return Ok(false);
        }
        request.prepared = true;
        request.completed = payloads.is_empty();
        request.claim_token = None;
        let now = Utc::now();
        let mut intents = self.delivery_intents.lock().unwrap();
        for (position, payload) in payloads.iter().enumerate() {
            intents
                .entry((notification_id, position as i32))
                .or_insert(MockDeliveryIntent {
                    payload: payload.clone(),
                    published: false,
                    claim_token: None,
                    attempt_count: 0,
                    created_at: now,
                });
        }
        Ok(true)
    }

    async fn release_delivery_request(
        &self,
        notification_id: Uuid,
        claim_token: DeliveryClaimToken,
    ) -> Result<(), Report> {
        if let Some(request) = self
            .delivery_requests
            .lock()
            .unwrap()
            .get_mut(&notification_id)
            && request.claim_token == Some(claim_token)
        {
            request.claim_token = None;
        }
        Ok(())
    }

    async fn claim_delivery_intent(
        &self,
        notification_id: Option<Uuid>,
        claim_token: DeliveryClaimToken,
        _lease: DeliveryLease,
    ) -> Result<Option<ClaimedDeliveryIntent>, Report> {
        let mut intents = self.delivery_intents.lock().unwrap();
        let entry = intents.iter_mut().find(|((id, _), intent)| {
            notification_id.is_none_or(|notification_id| *id == notification_id)
                && !intent.published
                && intent.claim_token.is_none()
        });
        let Some(((notification_id, position), intent)) = entry else {
            return Ok(None);
        };
        intent.claim_token = Some(claim_token);
        intent.attempt_count += 1;
        Ok(Some(ClaimedDeliveryIntent {
            notification_id: *notification_id,
            position: *position,
            claim_token,
            payload: intent.payload.clone(),
            attempt_count: intent.attempt_count,
            pending_since: intent.created_at,
        }))
    }

    async fn complete_delivery_intent(
        &self,
        notification_id: Uuid,
        position: i32,
        claim_token: DeliveryClaimToken,
    ) -> Result<bool, Report> {
        if self
            .intent_completion_errors_remaining
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                remaining.checked_sub(1)
            })
            .is_ok()
        {
            return Err(report!("injected delivery intent completion error"));
        }

        if self
            .intent_completion_failures_remaining
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                remaining.checked_sub(1)
            })
            .is_ok()
        {
            return Ok(false);
        }

        let mut intents = self.delivery_intents.lock().unwrap();
        let Some(intent) = intents.get_mut(&(notification_id, position)) else {
            return Ok(false);
        };
        if intent.claim_token != Some(claim_token) || intent.published {
            return Ok(false);
        }
        intent.published = true;
        intent.claim_token = None;
        let complete = intents
            .iter()
            .filter(|((id, _), _)| *id == notification_id)
            .all(|(_, intent)| intent.published);
        drop(intents);
        if complete
            && let Some(request) = self
                .delivery_requests
                .lock()
                .unwrap()
                .get_mut(&notification_id)
        {
            request.completed = true;
        }
        Ok(true)
    }

    async fn release_delivery_intent(
        &self,
        notification_id: Uuid,
        position: i32,
        claim_token: DeliveryClaimToken,
    ) -> Result<(), Report> {
        if self
            .intent_release_failures_remaining
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                remaining.checked_sub(1)
            })
            .is_ok()
        {
            return Err(report!("injected delivery intent release failure"));
        }

        if let Some(intent) = self
            .delivery_intents
            .lock()
            .unwrap()
            .get_mut(&(notification_id, position))
            && intent.claim_token == Some(claim_token)
        {
            intent.claim_token = None;
        }
        Ok(())
    }

    async fn claim_digest_receipt_cleanup(
        &self,
        _claim_token: DeliveryClaimToken,
        _lease: DeliveryLease,
        _orphan_cleanup_after: chrono::DateTime<Utc>,
    ) -> Result<Option<ClaimedDigestReceiptCleanup>, Report> {
        Ok(None)
    }

    async fn complete_digest_receipt_cleanup(
        &self,
        _notification_id: Uuid,
        _user_id: MacroUserIdStr<'_>,
        _generation: Uuid,
        _claim_token: DeliveryClaimToken,
    ) -> Result<bool, Report> {
        Ok(false)
    }

    async fn release_digest_receipt_cleanup(
        &self,
        _notification_id: Uuid,
        _user_id: MacroUserIdStr<'_>,
        _generation: Uuid,
        _claim_token: DeliveryClaimToken,
    ) -> Result<(), Report> {
        Ok(())
    }
}

impl NotificationRepository for std::sync::Arc<MockRepository> {
    async fn get_muted_users<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        (**self).get_muted_users(user_ids).await
    }

    async fn get_unsubscribed_users<'a>(
        &self,
        item_id: &str,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        (**self).get_unsubscribed_users(item_id, user_ids).await
    }

    async fn create_notification<'a, T: Serialize + Send + Sync>(
        &self,
        request: SendNotificationRequestBuilder<'a, TaggedContent<T>>,
        notification_id: Uuid,
        service_sender: &str,
        apns_collapse_key: Option<&str>,
    ) -> Result<Option<Vec<UserNotificationRow<Arc<T>>>>, Report> {
        (**self)
            .create_notification(request, notification_id, service_sender, apns_collapse_key)
            .await
    }

    async fn update_sent_status<'a>(
        &self,
        notification_id: Uuid,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<(), Report> {
        (**self).update_sent_status(notification_id, user_ids).await
    }

    async fn get_device_endpoints<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>, Report> {
        (**self).get_device_endpoints(user_ids).await
    }

    async fn mark_notifications_seen(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<Vec<UserNotificationRow<serde_json::Value>>, Report> {
        (**self)
            .mark_notifications_seen(user_id, notification_ids)
            .await
    }

    async fn mark_notifications_done(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
        done: bool,
    ) -> Result<Vec<UserNotificationRow<serde_json::Value>>, Report> {
        (**self)
            .mark_notifications_done(user_id, notification_ids, done)
            .await
    }

    async fn get_notification_ids_for_entities(
        &self,
        user_id: MacroUserIdStr<'_>,
        entities: &[model_entity::Entity<'_>],
    ) -> Result<Vec<Uuid>, Report> {
        (**self)
            .get_notification_ids_for_entities(user_id, entities)
            .await
    }

    async fn get_basic_notifications(
        &self,
        notification_ids: &[Uuid],
    ) -> Result<Vec<NotificationIdAndCollapseKey>, Report> {
        (**self).get_basic_notifications(notification_ids).await
    }

    async fn get_digest_eligible_notification_ids(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<HashSet<Uuid>, Report> {
        (**self)
            .get_digest_eligible_notification_ids(user_id, notification_ids)
            .await
    }

    async fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        limit: u32,
        cursor: models_pagination::Query<Uuid, models_pagination::CreatedAt, ()>,
        filters: crate::domain::models::request::NotificationListFilters,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        (**self)
            .get_user_notifications(user_id, limit, cursor, filters)
            .await
    }

    async fn get_user_notifications_by_event_item_ids<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        event_item_ids: &[Uuid],
        limit: u32,
        cursor: models_pagination::Query<Uuid, models_pagination::CreatedAt, ()>,
        filters: crate::domain::models::request::NotificationListFilters,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        (**self)
            .get_user_notifications_by_event_item_ids(
                user_id,
                event_item_ids,
                limit,
                cursor,
                filters,
            )
            .await
    }

    async fn get_entity_notifications_batch(
        &self,
        user_id: MacroUserIdStr<'_>,
        entities: Vec<Entity<'static>>,
    ) -> Result<HashMap<Entity<'static>, Vec<UserNotificationRow<serde_json::Value>>>, Report> {
        (**self)
            .get_entity_notifications_batch(user_id, entities)
            .await
    }

    async fn get_user_notification_by_id<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> Result<Option<UserNotificationRow<T>>, Report> {
        (**self)
            .get_user_notification_by_id(user_id, notification_id)
            .await
    }

    async fn delete_user_notification(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> Result<(), Report> {
        (**self)
            .delete_user_notification(user_id, notification_id)
            .await
    }

    async fn bulk_delete_user_notifications(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<(), Report> {
        (**self)
            .bulk_delete_user_notifications(user_id, notification_ids)
            .await
    }

    async fn delete_all_user_notifications(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<(), Report> {
        (**self).delete_all_user_notifications(user_id).await
    }

    async fn get_device_endpoint(
        &self,
        device_token: &str,
        device_type: &DeviceType,
    ) -> Result<Option<String>, Report> {
        (**self)
            .get_device_endpoint(device_token, device_type)
            .await
    }

    async fn upsert_device(
        &self,
        user_id: MacroUserIdStr<'_>,
        device_token: &str,
        device_endpoint: &str,
        device_type: &DeviceType,
    ) -> Result<(), Report> {
        (**self)
            .upsert_device(user_id, device_token, device_endpoint, device_type)
            .await
    }

    async fn delete_user_devices_by_token(
        &self,
        user_id: MacroUserIdStr<'_>,
        device_token: &str,
        device_type: &DeviceType,
    ) -> Result<Vec<String>, Report> {
        (**self)
            .delete_user_devices_by_token(user_id, device_token, device_type)
            .await
    }

    async fn delete_stale_devices_by_token(
        &self,
        device_token: &str,
        device_type: &DeviceType,
        active_endpoint: &str,
    ) -> Result<Vec<String>, Report> {
        (**self)
            .delete_stale_devices_by_token(device_token, device_type, active_endpoint)
            .await
    }

    async fn delete_device_by_endpoint(&self, endpoint_arn: &str) -> Result<(), Report> {
        (**self).delete_device_by_endpoint(endpoint_arn).await
    }

    async fn get_users_with_type_disabled<'a>(
        &self,
        notification_event_type: &str,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        (**self)
            .get_users_with_type_disabled(notification_event_type, user_ids)
            .await
    }

    async fn get_disabled_notification_types(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<crate::domain::models::DisabledNotificationType>, Report> {
        (**self).get_disabled_notification_types(user_id).await
    }

    async fn disable_notification_type(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_event_type: &str,
    ) -> Result<(), Report> {
        (**self)
            .disable_notification_type(user_id, notification_event_type)
            .await
    }

    async fn enable_notification_type(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_event_type: &str,
    ) -> Result<(), Report> {
        (**self)
            .enable_notification_type(user_id, notification_event_type)
            .await
    }
}

/// Mock queue that tracks published messages.
struct MockQueue {
    /// Stores serialized messages as JSON strings for inspection.
    published: Mutex<Vec<serde_json::Value>>,
}

impl MockQueue {
    fn new() -> Self {
        Self {
            published: Mutex::new(Vec::new()),
        }
    }

    fn get_published(&self) -> Vec<serde_json::Value> {
        self.published.lock().unwrap().clone()
    }
}

impl NotificationQueue for MockQueue {
    async fn publish<'a, T: serde::Serialize + Send + Sync, U: serde::Serialize + Send + Sync>(
        &self,
        messages: Vec<QueueMessage<'a, T, U>>,
    ) -> Result<(), Report> {
        let mut published = self.published.lock().unwrap();
        for message in messages {
            let json = serde_json::to_value(&message).unwrap();
            published.push(json);
        }
        Ok(())
    }

    async fn receive_messages(&self) -> Result<Vec<RawQueueMessage>, Report> {
        Ok(Vec::new())
    }

    async fn delete_message(&self, _receipt_handle: &str) -> Result<(), Report> {
        Ok(())
    }
}

impl NotificationQueue for std::sync::Arc<MockQueue> {
    async fn publish<'a, T: serde::Serialize + Send + Sync, U: serde::Serialize + Send + Sync>(
        &self,
        messages: Vec<QueueMessage<'a, T, U>>,
    ) -> Result<(), Report> {
        (**self).publish(messages).await
    }

    async fn receive_messages(&self) -> Result<Vec<RawQueueMessage>, Report> {
        (**self).receive_messages().await
    }

    async fn delete_message(&self, receipt_handle: &str) -> Result<(), Report> {
        (**self).delete_message(receipt_handle).await
    }
}

/// Queue fault injector whose publish-call numbers can fail once.
struct FaultQueue {
    attempts: AtomicUsize,
    fail_attempts: Mutex<HashSet<usize>>,
    published: Mutex<Vec<serde_json::Value>>,
}

impl FaultQueue {
    fn failing_on(attempts: impl IntoIterator<Item = usize>) -> Self {
        Self {
            attempts: AtomicUsize::new(0),
            fail_attempts: Mutex::new(attempts.into_iter().collect()),
            published: Mutex::new(Vec::new()),
        }
    }

    fn published(&self) -> Vec<serde_json::Value> {
        self.published.lock().unwrap().clone()
    }
}

impl NotificationQueue for Arc<FaultQueue> {
    async fn publish<'a, T: Serialize + Send + Sync, U: Serialize + Send + Sync>(
        &self,
        messages: Vec<QueueMessage<'a, T, U>>,
    ) -> Result<(), Report> {
        let attempt = self.attempts.fetch_add(1, Ordering::Relaxed) + 1;
        if self.fail_attempts.lock().unwrap().remove(&attempt) {
            return Err(report!("injected queue publication failure"));
        }

        let values = messages
            .into_iter()
            .map(serde_json::to_value)
            .collect::<Result<Vec<_>, _>>()?;
        self.published.lock().unwrap().extend(values);
        Ok(())
    }

    async fn receive_messages(&self) -> Result<Vec<RawQueueMessage>, Report> {
        Ok(Vec::new())
    }

    async fn delete_message(&self, _receipt_handle: &str) -> Result<(), Report> {
        Ok(())
    }
}

/// No-op mock for SNS endpoint management used in reader service tests.
struct MockSnsEndpoint;

impl SnsEndpointManager for MockSnsEndpoint {
    async fn create_platform_endpoint(
        &self,
        _platform_arn: &str,
        _token: &str,
    ) -> Result<String, Report> {
        Ok(String::new())
    }

    async fn get_endpoint_attributes(
        &self,
        _endpoint_arn: &str,
    ) -> Result<HashMap<String, String>, Report> {
        Ok(HashMap::new())
    }

    async fn set_endpoint_attributes(
        &self,
        _endpoint_arn: &str,
        _attributes: HashMap<String, String>,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn delete_endpoint(&self, _endpoint_arn: &str) -> Result<(), Report> {
        Ok(())
    }
}

fn test_platform_config() -> PlatformArnConfig {
    PlatformArnConfig {
        apns_platform_arn: "arn:aws:sns:us-east-1:000:app/APNS/test".to_string(),
        fcm_platform_arn: "arn:aws:sns:us-east-1:000:app/GCM/test".to_string(),
        apns_voip_platform_arn: "arn:aws:sns:us-east-1:000:app/APNS_VOIP/test".to_string(),
    }
}

#[tokio::test]
async fn test_send_notification_success() {
    let service =
        NotificationIngressService::new(MockRepository::new(), MockQueue::new(), MockStateMachine);

    let recipient = test_user_id("user@example.com");
    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([recipient.clone()]),
    }
    .into_request();

    let result = service.send_notification(request).await.unwrap().unwrap();

    assert!(result.notified_recipients.contains(&recipient));
}

#[tokio::test]
async fn test_sender_excluded_from_recipients() {
    let service =
        NotificationIngressService::new(MockRepository::new(), MockQueue::new(), MockStateMachine);

    let sender = test_user_id("sender@example.com");
    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: Some(sender.clone()),
        recipient_ids: HashSet::from([sender.clone()]),
    }
    .into_request();

    let result = service.send_notification(request).await.unwrap();

    // Sender should be excluded, no valid recipients remain
    assert!(result.is_none());
}

#[tokio::test]
async fn test_muted_user_excluded() {
    let muted_user = test_user_id("muted@example.com");
    let service = NotificationIngressService::new(
        MockRepository::new().with_muted_user(muted_user.clone()),
        MockQueue::new(),
        MockStateMachine,
    );

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([muted_user]),
    }
    .into_request();

    let result = service.send_notification(request).await.unwrap();

    // Muted user should be excluded, no valid recipients remain
    assert!(result.is_none());
}

#[tokio::test]
async fn test_unsubscribed_user_excluded() {
    let unsubscribed_user = test_user_id("unsubscribed@example.com");
    let service = NotificationIngressService::new(
        MockRepository::new().with_unsubscribed_user(unsubscribed_user.clone()),
        MockQueue::new(),
        MockStateMachine,
    );

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([unsubscribed_user]),
    }
    .into_request();

    let result = service.send_notification(request).await.unwrap();

    // Unsubscribed user should be excluded, no valid recipients remain
    assert!(result.is_none());
}

#[tokio::test]
async fn test_type_disabled_user_excluded() {
    let disabled_user = test_user_id("disabled@example.com");
    let service = NotificationIngressService::new(
        MockRepository::new().with_type_disabled_user(disabled_user.clone()),
        MockQueue::new(),
        MockStateMachine,
    );

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([disabled_user]),
    }
    .into_request();

    let result = service.send_notification(request).await.unwrap();

    // User with type disabled should be excluded, no valid recipients remain
    assert!(result.is_none());
}

#[tokio::test]
async fn test_queue_message_conn_gateway_only() {
    use std::sync::Arc;

    let queue = Arc::new(MockQueue::new());
    let service =
        NotificationIngressService::new(MockRepository::new(), queue.clone(), MockStateMachine);

    let recipient = test_user_id("user@example.com");
    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([recipient.clone()]),
    }
    .into_request()
    .with_conn_gateway();

    service.send_notification(request).await.unwrap();

    let published = queue.get_published();
    assert_eq!(published.len(), 1);

    let msg = &published[0];
    assert_eq!(msg["message_type"], "test_notification");
    assert!(msg["content"]["ConnGateway"].is_object());
}

#[tokio::test]
async fn test_queue_message_email_per_recipient() {
    use std::sync::Arc;

    let queue = Arc::new(MockQueue::new());
    let service =
        NotificationIngressService::new(MockRepository::new(), queue.clone(), MockStateMachine);

    let recipient1 = test_user_id("user1@example.com");
    let recipient2 = test_user_id("user2@example.com");
    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([recipient1.clone(), recipient2.clone()]),
    }
    .into_request()
    .with_email();

    service.send_notification(request).await.unwrap();

    let published = queue.get_published();
    // Email is 1:1, so we should have 2 messages (one per recipient)
    assert_eq!(published.len(), 2);

    for msg in &published {
        assert_eq!(msg["message_type"], "test_notification");
        assert!(msg["content"]["Email"].is_object());
    }
}

#[tokio::test]
async fn test_queue_message_multiple_channels() {
    use std::sync::Arc;

    let recipient = test_user_id("user@example.com");
    let queue = Arc::new(MockQueue::new());
    let repo = MockRepository::new().with_device_endpoint(
        recipient.clone(),
        DeviceEndpoint::Ios("arn:aws:sns:test".to_string()),
    );
    let service = NotificationIngressService::new(repo, queue.clone(), MockStateMachine);

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("entity_1"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([recipient.clone()]),
    }
    .into_request()
    .with_conn_gateway()
    .with_apns()
    .with_email();

    service.send_notification(request).await.unwrap();

    let published = queue.get_published();
    // Should have 3 messages: 1 conn_gateway + 1 iOS + 1 email
    assert_eq!(published.len(), 3);

    let has_conn_gateway = published
        .iter()
        .any(|m| m["content"]["ConnGateway"].is_object());
    let has_ios = published.iter().any(|m| m["content"]["Ios"].is_object());
    let has_email = published.iter().any(|m| m["content"]["Email"].is_object());

    assert!(has_conn_gateway, "Should have ConnGateway message");
    assert!(has_ios, "Should have iOS message");
    assert!(has_email, "Should have Email message");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_delivery_outbox_recovers_publish_failure_and_two_replays(pool: sqlx::PgPool) {
    let notification_id = Uuid::now_v7();
    let recipient = test_user_id("outbox-replay@example.com");
    let queue = Arc::new(FaultQueue::failing_on([1]));
    let service = NotificationIngressService::new(
        DbNotificationRepository::new(pool.clone()),
        queue.clone(),
        MockStateMachine,
    );

    assert!(
        service
            .send_notification(conn_request(notification_id, recipient.clone()))
            .await
            .is_err(),
        "the injected queue failure must reach the ingress caller"
    );

    let persisted: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notification_delivery_outbox WHERE notification_id = $1",
    )
    .bind(notification_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        persisted, 1,
        "delivery remains durable after publish failure"
    );

    sqlx::query(
        "UPDATE notification_delivery_outbox_intent SET next_attempt_at = now() WHERE notification_id = $1",
    )
    .bind(notification_id)
    .execute(&pool)
    .await
    .unwrap();

    let second = service
        .send_notification(conn_request(notification_id, recipient.clone()))
        .await
        .unwrap()
        .unwrap();
    sqlx::query("DELETE FROM notification_digest_receipt_cleanup WHERE notification_id = $1")
        .bind(notification_id)
        .execute(&pool)
        .await
        .unwrap();
    let third = service
        .send_notification(conn_request(notification_id, recipient.clone()))
        .await
        .unwrap()
        .unwrap();

    assert_eq!(
        second.notified_recipients,
        HashSet::from([recipient.clone()])
    );
    assert_eq!(third.notified_recipients, HashSet::from([recipient]));
    assert_eq!(
        queue.published().len(),
        1,
        "completed intent is not replayed"
    );
    let cleanup_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notification_digest_receipt_cleanup WHERE notification_id = $1",
    )
    .bind(notification_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        cleanup_count, 0,
        "completed duplicate must not recreate a cleanup obligation"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_delivery_outbox_resumes_after_partial_channel_publish(pool: sqlx::PgPool) {
    let notification_id = Uuid::now_v7();
    let recipient = test_user_id("outbox-partial@example.com");
    let queue = Arc::new(FaultQueue::failing_on([2]));
    let service = NotificationIngressService::new(
        DbNotificationRepository::new(pool.clone()),
        queue.clone(),
        MockStateMachine,
    );
    let request = || {
        SendNotificationRequestBuilder {
            notification_entity: EntityType::Document
                .with_entity_string("partial-delivery".to_string()),
            secondary_notification_entity: None,
            notification: TestNotification {
                message: "partial".to_string(),
            },
            sender_id: None,
            recipient_ids: HashSet::from([recipient.clone()]),
        }
        .into_request_with_id(notification_id)
        .with_conn_gateway()
        .with_email()
    };

    assert!(service.send_notification(request()).await.is_err());
    assert_eq!(queue.published().len(), 1, "first channel was handed off");

    sqlx::query(
        "UPDATE notification_delivery_outbox_intent SET next_attempt_at = now() WHERE notification_id = $1 AND published_at IS NULL",
    )
    .bind(notification_id)
    .execute(&pool)
    .await
    .unwrap();
    service.send_notification(request()).await.unwrap();

    let published = queue.published();
    assert_eq!(published.len(), 2);
    assert_eq!(
        published
            .iter()
            .filter(|message| message["content"]["ConnGateway"].is_object())
            .count(),
        1
    );
    assert_eq!(
        published
            .iter()
            .filter(|message| message["content"]["Email"].is_object())
            .count(),
        1
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_concurrent_duplicate_ingress_publishes_one_completed_intent(pool: sqlx::PgPool) {
    let notification_id = Uuid::now_v7();
    let recipient = test_user_id("outbox-concurrent@example.com");
    let queue = Arc::new(MockQueue::new());
    let first = NotificationIngressService::new(
        DbNotificationRepository::new(pool.clone()),
        queue.clone(),
        MockStateMachine,
    );
    let second = NotificationIngressService::new(
        DbNotificationRepository::new(pool.clone()),
        queue.clone(),
        MockStateMachine,
    );

    let (first_result, second_result) = tokio::join!(
        first.send_notification(conn_request(notification_id, recipient.clone())),
        second.send_notification(conn_request(notification_id, recipient)),
    );
    first_result.unwrap();
    second_result.unwrap();

    assert_eq!(queue.get_published().len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_legacy_duplicate_restores_original_recipient_before_mute_filter(pool: sqlx::PgPool) {
    let notification_id = Uuid::now_v7();
    let recipient = test_user_id("legacy-muted@example.com");
    let repository = DbNotificationRepository::new(pool.clone());
    repository
        .create_notification(
            SendNotificationRequestBuilder {
                notification_entity: EntityType::Document.with_entity_str("legacy"),
                secondary_notification_entity: None,
                notification: TaggedContent::new(TestNotification {
                    message: "legacy".to_string(),
                }),
                sender_id: None,
                recipient_ids: HashSet::from([recipient.clone()]),
            },
            notification_id,
            "test",
            None,
        )
        .await
        .unwrap();
    sqlx::query("INSERT INTO user_mute_notification (user_id) VALUES ($1)")
        .bind(recipient.as_ref())
        .execute(&pool)
        .await
        .unwrap();

    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(repository, queue.clone(), MockStateMachine);
    let result = service
        .send_notification(conn_request(notification_id, recipient.clone()))
        .await
        .unwrap()
        .unwrap();

    assert_eq!(result.notified_recipients, HashSet::from([recipient]));
    assert_eq!(queue.get_published().len(), 1);
}

#[tokio::test]
async fn test_digest_replay_after_ingest_before_intent_persistence_reuses_generation() {
    let notification_id = Uuid::now_v7();
    let recipient = test_user_id("digest-replay@example.com");
    let state_machine = Arc::new(ReplaySafeDigestStateMachine::new());
    let service = NotificationIngressService::new(
        MockRepository::new().with_prepare_failures(1),
        MockQueue::new(),
        state_machine.clone(),
    );

    assert!(
        service
            .send_notification(conn_request(notification_id, recipient.clone()))
            .await
            .is_err()
    );
    service
        .send_notification(conn_request(notification_id, recipient))
        .await
        .unwrap();

    assert_eq!(state_machine.ingest_attempts.load(Ordering::Relaxed), 2);
    let generations = state_machine.delivery_generations.lock().unwrap();
    assert_eq!(generations.len(), 2);
    assert_eq!(generations[0], generations[1]);
}

#[tokio::test]
async fn test_unconfirmed_intent_completion_stops_inline_republication() {
    let notification_id = Uuid::now_v7();
    let recipient = test_user_id("completion-expired@example.com");
    let repository = Arc::new(MockRepository::new().with_intent_completion_failures(1));
    let queue = Arc::new(MockQueue::new());
    let service =
        NotificationIngressService::new(repository.clone(), queue.clone(), MockStateMachine);

    assert!(
        service
            .send_notification(conn_request(notification_id, recipient.clone()))
            .await
            .is_err()
    );
    assert_eq!(queue.get_published().len(), 1);
    let intent = repository
        .delivery_intents
        .lock()
        .unwrap()
        .values()
        .next()
        .cloned()
        .unwrap();
    assert!(!intent.published);
    assert!(intent.claim_token.is_none());

    service
        .send_notification(conn_request(notification_id, recipient))
        .await
        .unwrap();
    assert_eq!(queue.get_published().len(), 2);
}

#[tokio::test]
async fn test_unconfirmed_intent_completion_stops_recovery_batch() {
    let notification_id = Uuid::now_v7();
    let recipient = test_user_id("recovery-completion-expired@example.com");
    let repository = Arc::new(MockRepository::new());
    let queue = Arc::new(FaultQueue::failing_on([1]));
    let service =
        NotificationIngressService::new(repository.clone(), queue.clone(), MockStateMachine);

    assert!(
        service
            .send_notification(conn_request(notification_id, recipient))
            .await
            .is_err()
    );
    repository
        .intent_completion_failures_remaining
        .store(1, Ordering::Relaxed);

    assert!(service.recover_pending_deliveries(10).await.is_err());
    assert_eq!(queue.attempts.load(Ordering::Relaxed), 2);
    assert_eq!(queue.published().len(), 1);
    let intent = repository
        .delivery_intents
        .lock()
        .unwrap()
        .values()
        .next()
        .cloned()
        .unwrap();
    assert!(!intent.published);
    assert!(intent.claim_token.is_none());

    service.recover_pending_deliveries(10).await.unwrap();
    assert_eq!(queue.published().len(), 2);
}

#[tokio::test]
async fn test_unconfirmed_completion_outcomes_stop_recovery_batch() {
    for (completion_errors, release_errors) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
        let notification_id = Uuid::now_v7();
        let recipient = test_user_id(&format!(
            "recovery-completion-{completion_errors}-release-{release_errors}@example.com"
        ));
        let repository = Arc::new(MockRepository::new());
        let queue = Arc::new(FaultQueue::failing_on([1]));
        let service =
            NotificationIngressService::new(repository.clone(), queue.clone(), MockStateMachine);

        assert!(
            service
                .send_notification(conn_request(notification_id, recipient))
                .await
                .is_err()
        );
        if completion_errors == 0 {
            repository
                .intent_completion_failures_remaining
                .store(1, Ordering::Relaxed);
        } else {
            repository
                .intent_completion_errors_remaining
                .store(1, Ordering::Relaxed);
        }
        repository
            .intent_release_failures_remaining
            .store(release_errors, Ordering::Relaxed);

        assert!(service.recover_pending_deliveries(10).await.is_err());
        assert_eq!(queue.attempts.load(Ordering::Relaxed), 2);
        assert_eq!(queue.published().len(), 1);
        let intent = repository
            .delivery_intents
            .lock()
            .unwrap()
            .values()
            .next()
            .cloned()
            .unwrap();
        assert!(!intent.published);
        assert_eq!(intent.claim_token.is_some(), release_errors == 1);
    }
}

#[tokio::test]
async fn test_state_machine_error_keeps_preparation_retryable() {
    let notification_id = Uuid::now_v7();
    let recipient = test_user_id("state-error@example.com");
    let repository = Arc::new(MockRepository::new());
    let service =
        NotificationIngressService::new(repository.clone(), MockQueue::new(), FailingStateMachine);

    assert!(
        service
            .send_notification(conn_request(notification_id, recipient))
            .await
            .is_err()
    );
    let requests = repository.delivery_requests.lock().unwrap();
    let request = requests.get(&notification_id).unwrap();
    assert!(!request.prepared);
    assert!(request.claim_token.is_none());
    assert!(repository.delivery_intents.lock().unwrap().is_empty());
}

#[cfg(feature = "redis-tests")]
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_recovery_retries_and_completes_actual_digest_receipt_cleanup(pool: sqlx::PgPool) {
    use crate::outbound::digest_batcher::RedisDigestBatcher;
    use redis::AsyncCommands;

    let redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let client = redis::Client::open(redis_url).unwrap();
    let mut connection = client.get_multiplexed_async_connection().await.unwrap();
    let prefix = format!("test_service_cleanup_{}", Uuid::now_v7().as_simple());
    let notification_id = Uuid::now_v7();
    let recipient = test_user_id("service-cleanup@example.com");
    let repository = DbNotificationRepository::new(pool.clone());
    repository
        .persist_notification_with_delivery_request(
            conn_request(notification_id, recipient.clone()),
            "test",
        )
        .await
        .unwrap();
    let preparation_token = DeliveryClaimToken::new();
    let claimed = repository
        .claim_delivery_request(
            Some(notification_id),
            preparation_token,
            DeliveryLease::until(Utc::now() + chrono::Duration::seconds(30)),
        )
        .await
        .unwrap()
        .unwrap();
    let generation = claimed.generation;
    let digest_notification = claimed.notifications[0].clone();
    repository
        .prepare_delivery_intents(
            notification_id,
            preparation_token,
            &[],
            Utc::now() - chrono::Duration::seconds(1),
        )
        .await
        .unwrap();

    RedisDigestBatcher::with_key_prefix(connection.clone(), &prefix)
        .add_to_digest_for_delivery_generation(
            &digest_notification,
            generation,
            Duration::from_secs(60),
        )
        .await
        .unwrap();
    let receipt_key = format!(
        "{prefix}:digest_receipt:{}:{notification_id}:{generation}",
        recipient.as_ref()
    );
    assert!(connection.exists::<_, bool>(&receipt_key).await.unwrap());

    let service = NotificationIngressService::new(
        repository,
        MockQueue::new(),
        RedisCleanupStateMachine {
            batcher: RedisDigestBatcher::with_key_prefix(connection.clone(), &prefix),
            failures_remaining: AtomicUsize::new(1),
        },
    );
    assert!(service.recover_pending_deliveries(1).await.is_err());
    assert!(connection.exists::<_, bool>(&receipt_key).await.unwrap());
    let obligation_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notification_digest_receipt_cleanup WHERE notification_id = $1 AND generation = $2",
    )
    .bind(notification_id)
    .bind(generation)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(obligation_count, 1);

    sqlx::query(
        "UPDATE notification_digest_receipt_cleanup SET safe_after = now() WHERE notification_id = $1 AND generation = $2",
    )
    .bind(notification_id)
    .bind(generation)
    .execute(&pool)
    .await
    .unwrap();
    service.recover_pending_deliveries(2).await.unwrap();

    assert!(!connection.exists::<_, bool>(&receipt_key).await.unwrap());
    let obligation_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notification_digest_receipt_cleanup WHERE notification_id = $1 AND generation = $2",
    )
    .bind(notification_id)
    .bind(generation)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(obligation_count, 0);

    let keys: Vec<String> = redis::cmd("KEYS")
        .arg(format!("{prefix}:*"))
        .query_async(&mut connection)
        .await
        .unwrap();
    for key in keys {
        connection.del::<_, ()>(key).await.unwrap();
    }
}

#[tokio::test]
async fn test_apns_enqueues_correct_data_for_multiple_users() {
    use std::sync::Arc;

    let user1 = test_user_id("alice@example.com");
    let user2 = test_user_id("bob@example.com");
    let user3 = test_user_id("charlie@example.com");

    let queue = Arc::new(MockQueue::new());
    let repo = MockRepository::new()
        .with_device_endpoint(
            user1.clone(),
            DeviceEndpoint::Ios(
                "arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice-device".to_string(),
            ),
        )
        .with_device_endpoint(
            user2.clone(),
            DeviceEndpoint::Ios(
                "arn:aws:sns:us-east-1:111:endpoint/APNS/app/bob-device".to_string(),
            ),
        )
        .with_device_endpoint(
            user2.clone(),
            DeviceEndpoint::Ios(
                "arn:aws:sns:us-east-1:111:endpoint/APNS/app/bob-device-2".to_string(),
            ),
        )
        .with_device_endpoint(
            user3.clone(),
            DeviceEndpoint::Ios(
                "arn:aws:sns:us-east-1:111:endpoint/APNS/app/charlie-device".to_string(),
            ),
        );

    let service = NotificationIngressService::new(repo, queue.clone(), MockStateMachine);

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("doc_123"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "You were mentioned".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([user1.clone(), user2.clone(), user3.clone()]),
    }
    .into_request()
    .with_apns();

    service.send_notification(request).await.unwrap();

    let published = queue.get_published();
    assert_eq!(
        published.len(),
        1,
        "APNS produces a single queue message for all recipients"
    );

    let msg = &published[0];
    assert_eq!(msg["message_type"], "test_notification");

    // The message should be an Ios variant
    let ios = &msg["content"]["Ios"];
    assert!(ios.is_object(), "Expected Ios notification channel");

    // Verify the APNS notification payload contains the notification data
    // push_notification_data is #[serde(flatten)]'d so fields appear directly on notif
    let apns_notif = &ios["notif"];
    assert_eq!(
        apns_notif["message"], "You were mentioned",
        "APNS payload should contain the flattened notification data"
    );

    // Verify message attributes
    let attrs = &ios["attributes"];
    assert_eq!(attrs["push_type"], "Alert");
    let expected_key = NotifCollapseKey::new("test").into_hashed().into_inner();
    assert_eq!(attrs["collapse_key"], expected_key);

    // Verify all device endpoints from all users are included (now keyed by user)
    let endpoints_map = ios["ios_device_endpoints"]
        .as_object()
        .expect("ios_device_endpoints should be an object keyed by user ID");

    // Collect all endpoints across all users
    let all_endpoints: Vec<&str> = endpoints_map
        .values()
        .flat_map(|user| {
            user["endpoints"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap())
        })
        .collect();

    assert_eq!(
        all_endpoints.len(),
        4,
        "Should include all 4 device endpoints across 3 users"
    );
    assert!(
        all_endpoints.contains(&"arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice-device"),
        "Should include alice's device"
    );
    assert!(
        all_endpoints.contains(&"arn:aws:sns:us-east-1:111:endpoint/APNS/app/bob-device"),
        "Should include bob's first device"
    );
    assert!(
        all_endpoints.contains(&"arn:aws:sns:us-east-1:111:endpoint/APNS/app/bob-device-2"),
        "Should include bob's second device"
    );
    assert!(
        all_endpoints.contains(&"arn:aws:sns:us-east-1:111:endpoint/APNS/app/charlie-device"),
        "Should include charlie's device"
    );
}

#[tokio::test]
async fn test_apns_collapse_key_stored_on_create() {
    use std::sync::Arc;

    let user = test_user_id("alice@example.com");

    let repo = Arc::new(MockRepository::new().with_device_endpoint(
        user.clone(),
        DeviceEndpoint::Ios("arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice".to_string()),
    ));
    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(repo.clone(), queue, MockStateMachine);

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("doc_1"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([user]),
    }
    .into_request()
    .with_apns();

    service.send_notification(request).await.unwrap();

    let collapse_keys = repo.stored_collapse_keys.lock().unwrap();
    assert_eq!(collapse_keys.len(), 1);
    assert_eq!(
        collapse_keys[0].1,
        Some(NotifCollapseKey::new("test").into_hashed().into_inner()),
        "APNS collapse key should be stored when creating the notification"
    );
}

#[tokio::test]
async fn test_no_apns_collapse_key_when_apns_not_enabled() {
    use std::sync::Arc;

    let user = test_user_id("alice@example.com");

    let repo = Arc::new(MockRepository::new());
    let queue = Arc::new(MockQueue::new());
    let service = NotificationIngressService::new(repo.clone(), queue, MockStateMachine);

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("doc_1"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([user]),
    }
    .into_request()
    .with_conn_gateway();

    service.send_notification(request).await.unwrap();

    let collapse_keys = repo.stored_collapse_keys.lock().unwrap();
    assert_eq!(collapse_keys.len(), 1);
    assert_eq!(
        collapse_keys[0].1, None,
        "No APNS collapse key should be stored when APNS is not enabled"
    );
}

// ============================================================================
// Egress Service Tests
// ============================================================================

/// Mock realtime sender that always succeeds.
struct MockRealtimeSender;

impl RealtimeSender for MockRealtimeSender {
    async fn send_notifications<'a, T: Serialize + Send + Sync>(
        &self,
        _recipients: &[MacroUserIdStr<'a>],
        _notification: &T,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        Ok(HashSet::new())
    }
}

/// Mock mobile push sender.
struct MockMobileSender;

impl NotificationSender for MockMobileSender {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        _endpoint_arn: &str,
        _notification: &crate::domain::models::apple::APNSPushNotification<T>,
        _attributes: &crate::domain::models::mobile::MessageAttributes,
    ) -> Result<String, Report> {
        Ok("mock-message-id".to_string())
    }

    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        _endpoint_arn: &str,
        _notification: &crate::domain::models::android::FCMMessage<T>,
        _attributes: &crate::domain::models::mobile::MessageAttributes,
    ) -> Result<String, Report> {
        Ok("mock-message-id".to_string())
    }
}

/// Mock email sender.
struct MockEmailSender;

impl EmailSender for MockEmailSender {
    async fn send_email(
        &self,
        _recipient: MacroUserIdStr<'_>,
        _content: &crate::domain::models::queue_message::EmailContent,
    ) -> Result<(), Report> {
        Ok(())
    }
}

/// Mock rate limit port that can be configured to allow or exceed.
struct MockRateLimitPort {
    should_exceed: bool,
}

impl rate_limit::RateLimitPort for MockRateLimitPort {
    async fn check(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        if self.should_exceed {
            Ok(RateLimitResult::Err(RateLimitExceeded {
                current_count: config.max_count.saturating_add(1),
                max_count: config.max_count,
                retry_after: config.window,
            }))
        } else {
            Ok(RateLimitResult::Ok(RateLimitOk::new_testing_value(
                1, key, config,
            )))
        }
    }

    async fn decrement(&self, _key: &RateLimitKey) -> Result<(), Report> {
        Ok(())
    }
}

fn allowing_rate_limiter() -> rate_limit::RateLimitServiceImpl<MockRateLimitPort> {
    rate_limit::RateLimitServiceImpl {
        repo: MockRateLimitPort {
            should_exceed: false,
        },
    }
}

fn exceeding_rate_limiter() -> rate_limit::RateLimitServiceImpl<MockRateLimitPort> {
    rate_limit::RateLimitServiceImpl {
        repo: MockRateLimitPort {
            should_exceed: true,
        },
    }
}

/// Mock egress state machine that forwards sends without recording message IDs or batching.
struct MockDigestBatcher;

impl DigestBatcher for MockDigestBatcher {
    async fn add_to_digest(
        &self,
        _notification: &UserNotificationRow<serde_json::Value>,
        _send_after: Duration,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn claim_ready_digest(&self) -> Result<ClaimResult<DigestBatch>, Report> {
        Ok(ClaimResult::Empty)
    }

    async fn remove_notification_receipt(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_id: Uuid,
        _delivery_generation: Uuid,
    ) -> Result<(), Report> {
        Ok(())
    }
}

struct MockEgressStateMachine;

impl crate::domain::models::email_notification_digest::BulkDigestEgressStateMachine
    for MockEgressStateMachine
{
    async fn continue_machine<
        N: crate::domain::models::email_notification_digest::ports::NotificationSendChecker,
    >(
        &self,
        req: crate::domain::models::email_notification_digest::ResumeMachineBRequest<N>,
    ) -> (
        Vec<Result<N::Ok, N::Err>>,
        either::Either<
            crate::domain::models::email_notification_digest::DontSend,
            Result<crate::domain::models::email_notification_digest::BatchSend<()>, Report>,
        >,
    ) {
        let mut results = Vec::with_capacity(req.send_notifs.len());
        let mut any_succeeded = false;

        for send_notif in req.send_notifs {
            match send_notif.send_notification().await {
                Ok(ok) => {
                    results.push(Ok(ok));
                    any_succeeded = true;
                }
                Err(err) => {
                    results.push(Err(err));
                }
            }
        }

        let decision = if any_succeeded {
            either::Either::Left(crate::domain::models::email_notification_digest::DontSend::new())
        } else {
            either::Either::Right(Ok(
                crate::domain::models::email_notification_digest::BatchSend::from_inner(()),
            ))
        };

        (results, decision)
    }
}

fn create_egress_service<R: rate_limit::RateLimitService>(
    rate_limiter: R,
) -> NotificationEgressService<
    MockQueue,
    MockRepository,
    MockRealtimeSender,
    MockMobileSender,
    MockEmailSender,
    R,
    MockEgressStateMachine,
    MockDigestBatcher,
> {
    NotificationEgressService {
        queue: MockQueue::new(),
        repository: MockRepository::new(),
        realtime: MockRealtimeSender,
        mobile: MockMobileSender,
        email: MockEmailSender,
        rate_limiter,
        state_machine: MockEgressStateMachine,
        digest_batcher: MockDigestBatcher,
    }
}

fn create_mock_notif<T: Notification>(meta: T) -> RealtimeNotif<TaggedContent<T>> {
    RealtimeNotif {
        notification_id: Uuid::nil(),
        notification_event_type: "testing".to_string(),
        entity: EntityType::Document.with_entity_str("testing"),
        sent: false,
        state: crate::domain::models::NotificationState::Unseen,
        created_at: Utc::now(),
        viewed_at: None,
        updated_at: Utc::now(),
        deleted_at: None,
        notification_metadata: TaggedContent::new(meta),
        sender_id: None,
    }
}

#[tokio::test]
async fn test_egress_rate_limit_exceeded() {
    let service = create_egress_service(exceeding_rate_limiter());

    let recipient = test_user_id("user@example.com");
    let email = EmailCreateBundle::new(&TestNotification {
        message: "Hello".to_string(),
    })
    .with_recipient(recipient);
    let message = QueueMessage::new_test(
        "test_notification".to_string(),
        NotificationChannel::Email(email),
    );

    let results = service.deliver_notification(message).await;

    // Should have exactly one error result for rate limit exceeded
    assert_eq!(results.len(), 1);
    assert!(results[0].is_err());

    let err = results[0].as_ref().unwrap_err();
    assert!(
        err.to_string().contains("rate limit"),
        "Error should mention rate limit: {}",
        err
    );
}

#[tokio::test]
async fn test_egress_rate_limit_allowed() {
    let service = create_egress_service(allowing_rate_limiter());

    let recipient = test_user_id("user@example.com");
    let email = EmailCreateBundle::new(&TestNotification {
        message: "Hello".to_string(),
    })
    .with_recipient(recipient);
    let message = QueueMessage::new_test(
        "test_notification".to_string(),
        NotificationChannel::Email(email),
    );

    let results = service.deliver_notification(message).await;

    // Should succeed
    assert_eq!(results.len(), 1);
    assert!(results[0].is_ok());
}

#[tokio::test]
async fn test_egress_conn_gateway_not_rate_limited() {
    let service = create_egress_service(exceeding_rate_limiter());

    let recipient = test_user_id("user@example.com");
    let message = QueueMessage::new_test(
        "test_notification".to_string(),
        NotificationChannel::ConnGateway(
            ConnGatewayNotification {
                notif: create_mock_notif(TestNotification {
                    message: "Hello".to_string(),
                }),
                recipients: vec![recipient],
            }
            .testing_to_value(),
        ),
    );

    let results = service.deliver_notification(message).await;

    // Should succeed - ConnGateway messages are not rate limited
    assert_eq!(results.len(), 1);
    assert!(results[0].is_ok());
}

// ============================================================================
// Notification Reader Tests
// ============================================================================

#[tokio::test]
async fn test_get_entity_notifications_batch_skips_invalid_tagged_metadata() {
    let user = test_user_id("alice@example.com");
    let entity_ref = EntityType::Document.with_entity_string("doc-1".to_string());
    let now = Utc::now();
    let valid_id = Uuid::now_v7();
    let invalid_id = Uuid::now_v7();
    let mut valid = updated_notification(user.clone(), valid_id, false, None, now);
    valid.notification_metadata = json!({ "message": "hello" });
    let mut invalid = updated_notification(user.clone(), invalid_id, false, None, now);
    invalid.notification_metadata = json!({ "unexpected": true });

    let service = NotificationReaderService {
        repository: Arc::new(
            MockRepository::new()
                .with_entity_notifications(entity_ref.clone(), vec![invalid, valid]),
        ),
        queue: Arc::new(MockQueue::new()),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };

    let notifications = service
        .get_entity_notifications_batch::<TestNotifEvent>(user, vec![entity_ref.clone()])
        .await
        .expect("invalid metadata does not fail the batch");

    assert_eq!(notifications[&entity_ref].len(), 1);
    let notification = &notifications[&entity_ref][0];
    assert_eq!(notification.notification_id, valid_id);
    assert_eq!(
        notification.notification_metadata,
        TestNotifEvent::TestNotification(TestNotification {
            message: "hello".to_string(),
        })
    );
}

#[tokio::test]
async fn test_get_entity_notifications_batch_deserializes_tagged_metadata() {
    let user = test_user_id("alice@example.com");
    let entity_ref = EntityType::Document.with_entity_string("doc-1".to_string());
    let notification_id = Uuid::now_v7();
    let now = Utc::now();
    let mut notification = updated_notification(user.clone(), notification_id, false, None, now);
    notification.notification_metadata = json!({ "message": "hello" });

    let service = NotificationReaderService {
        repository: Arc::new(
            MockRepository::new().with_entity_notifications(entity_ref.clone(), vec![notification]),
        ),
        queue: Arc::new(MockQueue::new()),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };

    let notifications = service
        .get_entity_notifications_batch::<TestNotifEvent>(user, vec![entity_ref.clone()])
        .await
        .expect("tagged notification metadata deserializes");

    let notification = &notifications[&entity_ref][0];
    assert_eq!(notification.notification_id, notification_id);
    assert_eq!(
        notification.notification_metadata,
        TestNotifEvent::TestNotification(TestNotification {
            message: "hello".to_string(),
        })
    );
}

// ============================================================================
// Mark Notifications Seen Tests
// ============================================================================

#[tokio::test]
async fn test_mark_seen_publishes_ios_clear_message() {
    use std::sync::Arc;

    let user = test_user_id("alice@example.com");
    let notif_id = Uuid::now_v7();

    let repo = Arc::new(
        MockRepository::new()
            .with_basic_notification(notif_id, "collapse_key_1".to_string())
            .with_device_endpoint(
                user.clone(),
                DeviceEndpoint::Ios(
                    "arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice".to_string(),
                ),
            ),
    );
    let queue = Arc::new(MockQueue::new());
    let service = NotificationReaderService {
        repository: repo.clone(),
        queue: queue.clone(),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };

    let notification_ids = [notif_id];
    service
        .update_notifications(UpdateNotificationsRequest {
            user_id: user.clone(),
            notification_ids: &notification_ids,
            status: NotificationStatus::Seen,
        })
        .await
        .unwrap();

    // Verify DB was updated
    let mark_seen_calls = repo.mark_seen_calls.lock().unwrap();
    assert_eq!(mark_seen_calls.len(), 1);
    assert_eq!(mark_seen_calls[0].1, vec![notif_id]);

    // Verify queue message was published
    let published = queue.get_published();
    assert_eq!(published.len(), 1);

    let msg = &published[0];
    assert_eq!(msg["message_type"], "clear_push_notification");

    // Should be an Ios variant with background push
    let ios = &msg["content"]["Ios"];
    assert!(ios.is_object(), "Expected Ios notification channel");

    // Verify silent background push payload
    let aps = &ios["notif"]["aps"];
    assert_eq!(aps["content-available"], 1);
    assert!(aps.get("alert").is_none() || aps["alert"].is_null());

    // Verify collapse key in attributes
    let attrs = &ios["attributes"];
    assert_eq!(attrs["push_type"], "Background");
    assert_eq!(attrs["collapse_key"], "collapse_key_1");

    // Verify identifier in custom data
    assert_eq!(ios["notif"]["identifier"], "collapse_key_1");

    // Verify device endpoint (now keyed by user)
    let endpoints_map = ios["ios_device_endpoints"].as_object().unwrap();
    let all_endpoints: Vec<&str> = endpoints_map
        .values()
        .flat_map(|user| {
            user["endpoints"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap())
        })
        .collect();
    assert_eq!(all_endpoints.len(), 1);
    assert_eq!(
        all_endpoints[0],
        "arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice"
    );
}

#[tokio::test]
async fn test_mark_seen_skips_push_when_no_collapse_key() {
    use std::sync::Arc;

    let user = test_user_id("bob@example.com");
    let notif_id = Uuid::now_v7();

    // No basic notifications with collapse keys (DB query filters them out)
    let repo = Arc::new(MockRepository::new().with_device_endpoint(
        user.clone(),
        DeviceEndpoint::Ios("arn:aws:sns:us-east-1:111:endpoint/APNS/app/bob".to_string()),
    ));
    let queue = Arc::new(MockQueue::new());
    let service = NotificationReaderService {
        repository: repo.clone(),
        queue: queue.clone(),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };

    let notification_ids = [notif_id];
    service
        .update_notifications(UpdateNotificationsRequest {
            user_id: user.clone(),
            notification_ids: &notification_ids,
            status: NotificationStatus::Seen,
        })
        .await
        .unwrap();

    // DB should still be updated
    let mark_seen_calls = repo.mark_seen_calls.lock().unwrap();
    assert_eq!(mark_seen_calls.len(), 1);

    // But no queue message should be published
    let published = queue.get_published();
    assert!(
        published.is_empty(),
        "Should not publish when no collapse keys"
    );
}

#[tokio::test]
async fn test_update_notifications_and_return_preserves_requested_order() {
    let user = test_user_id("reader@example.com");
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();
    let repo = Arc::new(MockRepository::new());
    let service = NotificationReaderService {
        repository: repo,
        queue: Arc::new(MockQueue::new()),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };
    let notification_ids = [second, first];

    let updated = service
        .update_notifications_and_return::<TestNotifEvent>(UpdateNotificationsRequest {
            user_id: user.clone(),
            notification_ids: &notification_ids,
            status: NotificationStatus::Done(false),
        })
        .await
        .unwrap();

    assert_eq!(
        updated
            .iter()
            .map(|notification| notification.notification_id)
            .collect::<Vec<_>>(),
        notification_ids
    );
    assert!(
        updated
            .iter()
            .all(|notification| notification.owner_id == user)
    );
    assert!(updated.iter().all(|notification| matches!(
        &notification.notification_metadata,
        TestNotifEvent::TestNotification(TestNotification { message })
            if message == "updated notification"
    )));
}

#[tokio::test]
async fn test_update_notifications_and_return_skips_invalid_tagged_metadata() {
    let user = test_user_id("invalid-updated-row@example.com");
    let valid_id = Uuid::now_v7();
    let invalid_id = Uuid::now_v7();
    let now = Utc::now();
    let valid = updated_notification(user.clone(), valid_id, false, None, now);
    let mut invalid = updated_notification(user.clone(), invalid_id, false, None, now);
    invalid.notification_event_type = "unknown_notification".to_string();

    let repo = Arc::new(MockRepository::new().with_updated_notifications(vec![invalid, valid]));
    let service = NotificationReaderService {
        repository: repo,
        queue: Arc::new(MockQueue::new()),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };

    let updated = service
        .update_notifications_and_return::<TestNotifEvent>(UpdateNotificationsRequest {
            user_id: user,
            notification_ids: &[invalid_id, valid_id],
            status: NotificationStatus::Done(false),
        })
        .await
        .expect("invalid metadata does not fail an already-committed update");

    assert_eq!(updated.len(), 1);
    assert_eq!(updated[0].notification_id, valid_id);
}

#[tokio::test]
async fn test_update_notifications_for_entities_uses_single_batch_lookup() {
    let user = test_user_id("entity-reader@example.com");
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();
    let repo = Arc::new(MockRepository::new().with_entity_notification_ids(vec![first, second]));
    let service = NotificationReaderService {
        repository: repo.clone(),
        queue: Arc::new(MockQueue::new()),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };

    let updated = service
        .update_notifications_for_entities::<TestNotifEvent>(
            UpdateNotificationsForEntitiesRequest {
                user_id: user.clone(),
                entities: vec![
                    EntityType::ChannelMessage.with_entity_str("message-1"),
                    EntityType::Document.with_entity_str("document-1"),
                ],
                status: NotificationStatus::Seen,
            },
        )
        .await
        .unwrap();

    assert_eq!(
        updated
            .iter()
            .map(|notification| notification.notification_id)
            .collect::<Vec<_>>(),
        vec![first, second]
    );
    assert_eq!(
        repo.entity_lookup_calls.lock().unwrap().as_slice(),
        [(
            user.to_string(),
            vec![
                (EntityType::ChannelMessage, "message-1".to_string()),
                (EntityType::Document, "document-1".to_string()),
            ],
        )]
    );
    assert_eq!(
        repo.mark_seen_calls.lock().unwrap().as_slice(),
        [(user.to_string(), vec![first, second])]
    );
}

#[tokio::test]
async fn test_update_notifications_for_entities_supports_done_status() {
    let user = test_user_id("done-entity-reader@example.com");
    let notification_id = Uuid::now_v7();
    let repo = Arc::new(MockRepository::new().with_entity_notification_ids(vec![notification_id]));
    let service = NotificationReaderService {
        repository: repo.clone(),
        queue: Arc::new(MockQueue::new()),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };

    service
        .update_notifications_for_entities::<TestNotifEvent>(
            UpdateNotificationsForEntitiesRequest {
                user_id: user.clone(),
                entities: vec![EntityType::Document.with_entity_str("document-1")],
                status: NotificationStatus::Done(true),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        repo.mark_done_calls.lock().unwrap().as_slice(),
        [(user.to_string(), vec![notification_id], true)]
    );
}

#[tokio::test]
async fn test_update_notifications_for_entities_noops_when_no_notifications_match() {
    let user = test_user_id("empty-entity-reader@example.com");
    let repo = Arc::new(MockRepository::new());
    let service = NotificationReaderService {
        repository: repo.clone(),
        queue: Arc::new(MockQueue::new()),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };

    let updated = service
        .update_notifications_for_entities::<TestNotifEvent>(
            UpdateNotificationsForEntitiesRequest {
                user_id: user,
                entities: vec![EntityType::Document.with_entity_str("doc-without-notifications")],
                status: NotificationStatus::Done(true),
            },
        )
        .await
        .unwrap();

    assert!(updated.is_empty());
    assert!(repo.mark_done_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn test_mark_seen_skips_push_when_no_device_endpoints() {
    use std::sync::Arc;

    let user = test_user_id("charlie@example.com");
    let notif_id = Uuid::now_v7();

    let repo = Arc::new(
        MockRepository::new().with_basic_notification(notif_id, "collapse_key_1".to_string()),
        // No device endpoints registered
    );
    let queue = Arc::new(MockQueue::new());
    let service = NotificationReaderService {
        repository: repo.clone(),
        queue: queue.clone(),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };

    let notification_ids = [notif_id];
    service
        .update_notifications(UpdateNotificationsRequest {
            user_id: user.clone(),
            notification_ids: &notification_ids,
            status: NotificationStatus::Seen,
        })
        .await
        .unwrap();

    // DB should still be updated
    let mark_seen_calls = repo.mark_seen_calls.lock().unwrap();
    assert_eq!(mark_seen_calls.len(), 1);

    // But no queue message should be published
    let published = queue.get_published();
    assert!(
        published.is_empty(),
        "Should not publish when no device endpoints"
    );
}

#[tokio::test]
async fn test_mark_done_updates_db_and_clears_push() {
    use std::sync::Arc;

    let user = test_user_id("alice@example.com");
    let notif_id = Uuid::now_v7();

    let repo = Arc::new(
        MockRepository::new()
            .with_basic_notification(notif_id, "collapse_key_1".to_string())
            .with_device_endpoint(
                user.clone(),
                DeviceEndpoint::Ios(
                    "arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice".to_string(),
                ),
            ),
    );
    let queue = Arc::new(MockQueue::new());
    let service = NotificationReaderService {
        repository: repo.clone(),
        queue: queue.clone(),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };

    let notification_ids = [notif_id];
    service
        .update_notifications(UpdateNotificationsRequest {
            user_id: user.clone(),
            notification_ids: &notification_ids,
            status: NotificationStatus::Done(true),
        })
        .await
        .unwrap();

    // Verify done was called (not seen)
    let mark_seen_calls = repo.mark_seen_calls.lock().unwrap();
    assert!(mark_seen_calls.is_empty(), "Should not call mark_seen");

    let mark_done_calls = repo.mark_done_calls.lock().unwrap();
    assert_eq!(mark_done_calls.len(), 1);
    assert_eq!(mark_done_calls[0].1, vec![notif_id]);
    assert!(mark_done_calls[0].2, "Should mark as done=true");

    // Verify push clearing was published (Done(true) should clear push)
    let published = queue.get_published();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0]["message_type"], "clear_push_notification");
}

#[tokio::test]
async fn test_mark_undone_updates_db_no_push_clear() {
    use std::sync::Arc;

    let user = test_user_id("alice@example.com");
    let notif_id = Uuid::now_v7();

    let repo = Arc::new(
        MockRepository::new()
            .with_basic_notification(notif_id, "collapse_key_1".to_string())
            .with_device_endpoint(
                user.clone(),
                DeviceEndpoint::Ios(
                    "arn:aws:sns:us-east-1:111:endpoint/APNS/app/alice".to_string(),
                ),
            ),
    );
    let queue = Arc::new(MockQueue::new());
    let service = NotificationReaderService {
        repository: repo.clone(),
        queue: queue.clone(),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };

    let notification_ids = [notif_id];
    service
        .update_notifications(UpdateNotificationsRequest {
            user_id: user.clone(),
            notification_ids: &notification_ids,
            status: NotificationStatus::Done(false),
        })
        .await
        .unwrap();

    // Verify done was called with false
    let mark_done_calls = repo.mark_done_calls.lock().unwrap();
    assert_eq!(mark_done_calls.len(), 1);
    assert!(!mark_done_calls[0].2, "Should mark as done=false");

    // Verify NO push clearing was published (Done(false) should not clear push)
    let published = queue.get_published();
    assert!(
        published.is_empty(),
        "Should not clear push when marking undone"
    );
}

/// Mock mobile sender that tracks attempted endpoints and can fail specific ones.
struct TrackingMobileSender {
    /// Endpoints that were attempted (for verification).
    attempted_endpoints: Mutex<Vec<String>>,
    /// Endpoints that should fail when attempted.
    failing_endpoints: HashSet<String>,
}

impl TrackingMobileSender {
    fn new(failing_endpoints: HashSet<String>) -> Self {
        Self {
            attempted_endpoints: Mutex::new(Vec::new()),
            failing_endpoints,
        }
    }

    fn get_attempted_endpoints(&self) -> Vec<String> {
        self.attempted_endpoints.lock().unwrap().clone()
    }
}

impl NotificationSender for TrackingMobileSender {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        _notification: &crate::domain::models::apple::APNSPushNotification<T>,
        _attributes: &crate::domain::models::mobile::MessageAttributes,
    ) -> Result<String, Report> {
        // Track that this endpoint was attempted
        self.attempted_endpoints
            .lock()
            .unwrap()
            .push(endpoint_arn.to_string());

        // Fail if this endpoint is in the failing set
        if self.failing_endpoints.contains(endpoint_arn) {
            rootcause::bail!("Simulated APNS failure for endpoint: {}", endpoint_arn);
        }

        Ok(format!("msg-id-{endpoint_arn}"))
    }

    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        _endpoint_arn: &str,
        _notification: &crate::domain::models::android::FCMMessage<T>,
        _attributes: &crate::domain::models::mobile::MessageAttributes,
    ) -> Result<String, Report> {
        Ok("mock-android-msg-id".to_string())
    }
}

#[tokio::test]
async fn test_egress_ios_attempts_all_endpoints_even_if_some_fail() {
    use crate::domain::models::apple::{APNSPushNotification, Aps};
    use crate::domain::models::mobile::{MessageAttributes, PushType};
    use crate::domain::models::queue_message::{APNSTargets, UserApnsEndpoints};

    let endpoint1 = "arn:aws:sns:us-east-1:111:endpoint/APNS/app/device1";
    let endpoint2 = "arn:aws:sns:us-east-1:111:endpoint/APNS/app/device2";
    let endpoint3 = "arn:aws:sns:us-east-1:111:endpoint/APNS/app/device3";
    let endpoint4 = "arn:aws:sns:us-east-1:111:endpoint/APNS/app/device4";

    // Configure endpoints 1 and 3 to fail
    let failing_endpoints: HashSet<String> = [endpoint1.to_string(), endpoint3.to_string()].into();

    let mobile_sender = std::sync::Arc::new(TrackingMobileSender::new(failing_endpoints));
    let service = NotificationEgressService {
        queue: MockQueue::new(),
        repository: MockRepository::new(),
        realtime: MockRealtimeSender,
        mobile: mobile_sender.clone(),
        email: MockEmailSender,
        rate_limiter: allowing_rate_limiter(),
        state_machine: MockEgressStateMachine,
        digest_batcher: MockDigestBatcher,
    };

    let user1 = test_user_id("alice@example.com");
    let user2 = test_user_id("bob@example.com");
    let message = QueueMessage::new_test(
        "test_notification".to_string(),
        NotificationChannel::Ios(Box::new(APNSTargets {
            notif: APNSPushNotification {
                aps: Aps::default(),
                push_notification_data: json!({"message": "Hello"}),
            },
            attributes: MessageAttributes {
                push_type: PushType::Alert,
                collapse_key: "test_collapse".to_string(),
            },
            ios_device_endpoints: HashMap::from([
                (
                    user1,
                    UserApnsEndpoints {
                        endpoints: vec![endpoint1.to_string(), endpoint2.to_string()],
                        digest_state: None,
                    },
                ),
                (
                    user2,
                    UserApnsEndpoints {
                        endpoints: vec![endpoint3.to_string(), endpoint4.to_string()],
                        digest_state: None,
                    },
                ),
            ]),
        })),
    );

    let results = service.deliver_notification(message).await;

    // Verify ALL 4 endpoints were attempted
    let attempted = mobile_sender.get_attempted_endpoints();
    assert_eq!(
        attempted.len(),
        4,
        "Should attempt delivery to all 4 endpoints, but only attempted: {:?}",
        attempted
    );
    assert!(
        attempted.contains(&endpoint1.to_string()),
        "Should attempt endpoint1"
    );
    assert!(
        attempted.contains(&endpoint2.to_string()),
        "Should attempt endpoint2"
    );
    assert!(
        attempted.contains(&endpoint3.to_string()),
        "Should attempt endpoint3"
    );
    assert!(
        attempted.contains(&endpoint4.to_string()),
        "Should attempt endpoint4"
    );

    // Verify we got 4 results (one per endpoint)
    assert_eq!(results.len(), 4, "Should have 4 results (one per endpoint)");

    // Verify 2 succeeded and 2 failed
    let successes = results.iter().filter(|r| r.is_ok()).count();
    let failures = results.iter().filter(|r| r.is_err()).count();
    assert_eq!(successes, 2, "Should have 2 successful deliveries");
    assert_eq!(failures, 2, "Should have 2 failed deliveries");
}

// --- poll_email_digests tests ---

struct ReadyDigestBatcher {
    batch: Mutex<Option<DigestBatch>>,
}

impl DigestBatcher for ReadyDigestBatcher {
    async fn add_to_digest(
        &self,
        _notification: &UserNotificationRow<serde_json::Value>,
        _send_after: Duration,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn claim_ready_digest(&self) -> Result<ClaimResult<DigestBatch>, Report> {
        match self.batch.lock().unwrap().take() {
            Some(batch) => Ok(ClaimResult::Ready(batch)),
            None => Ok(ClaimResult::Empty),
        }
    }

    async fn remove_notification_receipt(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_id: Uuid,
        _delivery_generation: Uuid,
    ) -> Result<(), Report> {
        Ok(())
    }
}

#[tokio::test]
async fn test_poll_email_digests_sends_email_for_ready_batch() {
    use std::sync::Arc;

    let user = test_user_id("digest@macro.com");
    let notif = UserNotificationRow {
        owner_id: user.clone(),
        notification_id: Uuid::nil(),
        notification_event_type: "test_notification".to_string(),
        entity: EntityType::Document.with_entity_str("doc-1"),
        sent: false,
        state: crate::domain::models::NotificationState::Unseen,
        created_at: Utc::now(),
        viewed_at: None,
        updated_at: Utc::now(),
        deleted_at: None,
        notification_metadata: serde_json::to_value(TestNotification {
            message: "hello from digest".to_string(),
        })
        .unwrap(),
        sender_id: None,
    };

    let batch = DigestBatch {
        user_id: user.clone(),
        notifications: vec![notif.into_tagged()],
    };

    let batcher = ReadyDigestBatcher {
        batch: Mutex::new(Some(batch)),
    };

    let queue = Arc::new(MockQueue::new());
    let service = NotificationEgressService {
        queue: queue.clone(),
        repository: MockRepository::new(),
        realtime: MockRealtimeSender,
        mobile: MockMobileSender,
        email: MockEmailSender,
        rate_limiter: allowing_rate_limiter(),
        state_machine: MockEgressStateMachine,
        digest_batcher: batcher,
    };

    fn digest_to_notif(batch: DigestBatch) -> Result<TestNotification, Report> {
        Ok(TestNotification {
            message: format!("You have {} notification(s)", batch.notifications.len()),
        })
    }

    service.poll_email_digests(&digest_to_notif).await.unwrap();

    let published = queue.get_published();
    assert_eq!(published.len(), 1);
    assert!(published[0]["content"]["Email"].is_object());
}

#[tokio::test]
async fn test_poll_email_digests_skips_when_all_notifications_ineligible() {
    use std::sync::Arc;

    let user = test_user_id("digest@macro.com");
    let notif = UserNotificationRow {
        owner_id: user.clone(),
        notification_id: Uuid::nil(),
        notification_event_type: "test_notification".to_string(),
        entity: EntityType::Document.with_entity_str("doc-1"),
        sent: false,
        state: crate::domain::models::NotificationState::Unseen,
        created_at: Utc::now(),
        viewed_at: None,
        updated_at: Utc::now(),
        deleted_at: None,
        notification_metadata: serde_json::to_value(TestNotification {
            message: "already read".to_string(),
        })
        .unwrap(),
        sender_id: None,
    };

    let batcher = ReadyDigestBatcher {
        batch: Mutex::new(Some(DigestBatch {
            user_id: user,
            notifications: vec![notif.into_tagged()],
        })),
    };

    let queue = Arc::new(MockQueue::new());
    let service = NotificationEgressService {
        queue: queue.clone(),
        repository: MockRepository::new().with_digest_eligible_notification_ids([]),
        realtime: MockRealtimeSender,
        mobile: MockMobileSender,
        email: MockEmailSender,
        rate_limiter: allowing_rate_limiter(),
        state_machine: MockEgressStateMachine,
        digest_batcher: batcher,
    };

    let digest_to_notif = |_batch: DigestBatch| -> Result<TestNotification, Report> {
        panic!("digest should not be rendered when no notifications remain eligible")
    };

    let result = service.poll_email_digests(&digest_to_notif).await.unwrap();

    assert!(matches!(result, ClaimResult::Ready(())));
    assert!(queue.get_published().is_empty());
}

#[tokio::test]
async fn test_poll_email_digests_filters_ineligible_notifications_before_rendering() {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    let user = test_user_id("digest@macro.com");
    let eligible_id = Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e77").unwrap();
    let ineligible_id = Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e78").unwrap();

    let make_notif = |notification_id, message: &str| UserNotificationRow {
        owner_id: user.clone(),
        notification_id,
        notification_event_type: "test_notification".to_string(),
        entity: EntityType::Document.with_entity_str("doc-1"),
        sent: false,
        state: crate::domain::models::NotificationState::Unseen,
        created_at: Utc::now(),
        viewed_at: None,
        updated_at: Utc::now(),
        deleted_at: None,
        notification_metadata: serde_json::to_value(TestNotification {
            message: message.to_string(),
        })
        .unwrap(),
        sender_id: None,
    };

    let batcher = ReadyDigestBatcher {
        batch: Mutex::new(Some(DigestBatch {
            user_id: user.clone(),
            notifications: vec![
                make_notif(eligible_id, "keep").into_tagged(),
                make_notif(ineligible_id, "drop").into_tagged(),
            ],
        })),
    };

    let rendered_count = Arc::new(AtomicUsize::new(0));
    let rendered_count_for_closure = rendered_count.clone();
    let digest_to_notif = move |batch: DigestBatch| -> Result<TestNotification, Report> {
        rendered_count_for_closure.store(batch.notifications.len(), Ordering::SeqCst);
        Ok(TestNotification {
            message: format!("You have {} notification(s)", batch.notifications.len()),
        })
    };

    let queue = Arc::new(MockQueue::new());
    let service = NotificationEgressService {
        queue: queue.clone(),
        repository: MockRepository::new().with_digest_eligible_notification_ids([eligible_id]),
        realtime: MockRealtimeSender,
        mobile: MockMobileSender,
        email: MockEmailSender,
        rate_limiter: allowing_rate_limiter(),
        state_machine: MockEgressStateMachine,
        digest_batcher: batcher,
    };

    service.poll_email_digests(&digest_to_notif).await.unwrap();

    assert_eq!(rendered_count.load(Ordering::SeqCst), 1);
    assert_eq!(queue.get_published().len(), 1);
}

#[tokio::test]
async fn test_poll_email_digests_noop_when_empty() {
    let service = create_egress_service(allowing_rate_limiter());

    fn digest_to_notif(_batch: DigestBatch) -> Result<TestNotification, Report> {
        panic!("should not be called when empty")
    }

    // MockDigestBatcher always returns Empty
    service.poll_email_digests(&digest_to_notif).await.unwrap();
}

// ============================================================================
// Poll-and-deliver tests (timeout + iOS delete)
// ============================================================================

/// Mock queue for poll_and_deliver tests that returns preset messages and tracks deletes.
struct EgressTestQueue {
    messages: Mutex<Vec<RawQueueMessage>>,
    deleted_handles: Mutex<Vec<String>>,
}

impl EgressTestQueue {
    fn new(messages: Vec<RawQueueMessage>) -> Self {
        Self {
            messages: Mutex::new(messages),
            deleted_handles: Mutex::new(Vec::new()),
        }
    }

    fn deleted_handles(&self) -> Vec<String> {
        self.deleted_handles.lock().unwrap().clone()
    }
}

impl NotificationQueue for EgressTestQueue {
    async fn publish<'a, T: Serialize + Send + Sync, U: Serialize + Send + Sync>(
        &self,
        _messages: Vec<QueueMessage<'a, T, U>>,
    ) -> Result<(), Report> {
        Ok(())
    }

    async fn receive_messages(&self) -> Result<Vec<RawQueueMessage>, Report> {
        Ok(self.messages.lock().unwrap().drain(..).collect())
    }

    async fn delete_message(&self, receipt_handle: &str) -> Result<(), Report> {
        self.deleted_handles
            .lock()
            .unwrap()
            .push(receipt_handle.to_string());
        Ok(())
    }
}

/// Realtime sender that hangs indefinitely (simulates a stuck connection).
struct HangingRealtimeSender;

impl RealtimeSender for HangingRealtimeSender {
    async fn send_notifications<'a, T: Serialize + Send + Sync>(
        &self,
        _recipients: &[MacroUserIdStr<'a>],
        _notification: &T,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        // Sleep longer than DELIVERY_TIMEOUT to guarantee the timeout fires.
        tokio::time::sleep(super::egress::DELIVERY_TIMEOUT + Duration::from_secs(1)).await;
        Ok(HashSet::new())
    }
}

/// Mobile sender that always fails.
struct FailingMobileSender;

impl NotificationSender for FailingMobileSender {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        _endpoint_arn: &str,
        _notification: &crate::domain::models::apple::APNSPushNotification<T>,
        _attributes: &crate::domain::models::mobile::MessageAttributes,
    ) -> Result<String, Report> {
        rootcause::bail!("Simulated APNS failure")
    }

    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        _endpoint_arn: &str,
        _notification: &crate::domain::models::android::FCMMessage<T>,
        _attributes: &crate::domain::models::mobile::MessageAttributes,
    ) -> Result<String, Report> {
        rootcause::bail!("Simulated FCM failure")
    }
}

#[tokio::test]
async fn test_poll_and_deliver_deletes_rate_limited_message() {
    let recipient = test_user_id("user@example.com");
    let email = EmailCreateBundle::new(&TestNotification {
        message: "Hello".to_string(),
    })
    .with_recipient(recipient);
    let message = QueueMessage::new_test(
        "test_notification".to_string(),
        NotificationChannel::Email(email),
    );

    let queue = EgressTestQueue::new(vec![RawQueueMessage {
        body: message,
        receipt_handle: "receipt-rate-limited".to_string(),
    }]);
    let service = NotificationEgressService {
        queue,
        repository: MockRepository::new(),
        realtime: MockRealtimeSender,
        mobile: MockMobileSender,
        email: MockEmailSender,
        rate_limiter: exceeding_rate_limiter(),
        state_machine: MockEgressStateMachine,
        digest_batcher: MockDigestBatcher,
    };

    let results = service.poll_and_deliver().await;

    assert_eq!(results.len(), 1);
    assert!(results[0].is_err());
    assert_eq!(
        service.queue.deleted_handles(),
        vec!["receipt-rate-limited"],
        "rate-limited messages must be deleted instead of retried"
    );
}

#[tokio::test]
async fn test_poll_and_deliver_times_out_slow_delivery() {
    tokio::time::pause();

    let recipient = test_user_id("user@example.com");
    let message = QueueMessage::new_test(
        "test_notification".to_string(),
        NotificationChannel::ConnGateway(
            ConnGatewayNotification {
                notif: create_mock_notif(TestNotification {
                    message: "Hello".to_string(),
                }),
                recipients: vec![recipient],
            }
            .testing_to_value(),
        ),
    );

    let queue = EgressTestQueue::new(vec![RawQueueMessage {
        body: message,
        receipt_handle: "receipt-timeout".to_string(),
    }]);

    let service = NotificationEgressService {
        queue,
        repository: MockRepository::new(),
        realtime: HangingRealtimeSender,
        mobile: MockMobileSender,
        email: MockEmailSender,
        rate_limiter: allowing_rate_limiter(),
        state_machine: MockEgressStateMachine,
        digest_batcher: MockDigestBatcher,
    };

    let results = service.poll_and_deliver().await;

    assert_eq!(results.len(), 1);
    assert!(results[0].is_err());

    let err = results[0].as_ref().unwrap_err();
    assert!(
        err.to_string().contains("timeout"),
        "Expected timeout error, got: {}",
        err
    );

    // Timed out messages should NOT be deleted (not an iOS failure)
    let deleted = service.queue.deleted_handles();
    assert!(
        deleted.is_empty(),
        "Timed out message should not be deleted from queue"
    );
}

#[tokio::test]
async fn test_poll_and_deliver_deletes_message_when_all_ios_failures() {
    use crate::domain::models::apple::{APNSPushNotification, Aps};
    use crate::domain::models::mobile::{MessageAttributes, PushType};
    use crate::domain::models::queue_message::{APNSTargets, UserApnsEndpoints};

    let user = test_user_id("alice@example.com");

    let message = QueueMessage::new_test(
        "test_notification".to_string(),
        NotificationChannel::Ios(Box::new(APNSTargets {
            notif: APNSPushNotification {
                aps: Aps::default(),
                push_notification_data: json!({"message": "Hello"}),
            },
            attributes: MessageAttributes {
                push_type: PushType::Alert,
                collapse_key: "test_collapse".to_string(),
            },
            ios_device_endpoints: HashMap::from([(
                user,
                UserApnsEndpoints {
                    endpoints: vec![
                        "arn:endpoint/device1".to_string(),
                        "arn:endpoint/device2".to_string(),
                    ],
                    digest_state: None,
                },
            )]),
        })),
    );

    let queue = EgressTestQueue::new(vec![RawQueueMessage {
        body: message,
        receipt_handle: "receipt-ios".to_string(),
    }]);

    let service = NotificationEgressService {
        queue,
        repository: MockRepository::new(),
        realtime: MockRealtimeSender,
        mobile: FailingMobileSender,
        email: MockEmailSender,
        rate_limiter: allowing_rate_limiter(),
        state_machine: MockEgressStateMachine,
        digest_batcher: MockDigestBatcher,
    };

    let results = service.poll_and_deliver().await;

    // All results should be failures
    assert!(!results.is_empty());
    assert!(results.iter().all(|r| r.is_err()));

    // Message should be deleted because all failures are iOS
    let deleted = service.queue.deleted_handles();
    assert_eq!(
        deleted,
        vec!["receipt-ios"],
        "Message should be deleted when all failures are iOS"
    );
}

// ============================================================================
// Ingress Queue Tests (SqsNotificationIngress + process_from_queue)
// ============================================================================

/// Mock ingress queue that tracks published messages.
struct MockIngressQueue {
    published: Mutex<Vec<crate::domain::models::queue_message::IngressQueueMessage>>,
}

impl MockIngressQueue {
    fn new() -> Self {
        Self {
            published: Mutex::new(Vec::new()),
        }
    }

    fn get_published_count(&self) -> usize {
        self.published.lock().unwrap().len()
    }
}

impl crate::domain::ports::NotificationIngressQueue for MockIngressQueue {
    async fn publish(
        &self,
        message: crate::domain::models::queue_message::IngressQueueMessage,
    ) -> Result<(), Report> {
        self.published.lock().unwrap().push(message);
        Ok(())
    }

    async fn receive_messages(
        &self,
    ) -> Result<Vec<crate::domain::models::queue_message::RawIngressQueueMessage>, Report> {
        Ok(Vec::new())
    }

    async fn delete_message(&self, _receipt_handle: &str) -> Result<(), Report> {
        Ok(())
    }
}

impl crate::domain::ports::NotificationIngressQueue for Arc<MockIngressQueue> {
    async fn publish(
        &self,
        message: crate::domain::models::queue_message::IngressQueueMessage,
    ) -> Result<(), Report> {
        (**self).publish(message).await
    }

    async fn receive_messages(
        &self,
    ) -> Result<Vec<crate::domain::models::queue_message::RawIngressQueueMessage>, Report> {
        (**self).receive_messages().await
    }

    async fn delete_message(&self, receipt_handle: &str) -> Result<(), Report> {
        (**self).delete_message(receipt_handle).await
    }
}

#[tokio::test]
async fn test_sqs_notification_ingress_publishes_to_queue() {
    use crate::domain::service::SqsNotificationIngress;

    let queue = Arc::new(MockIngressQueue::new());
    let ingress = SqsNotificationIngress {
        queue: queue.clone(),
    };

    let recipient = test_user_id("user@example.com");
    let request = SendNotificationRequestBuilder {
        notification_entity: model_entity::EntityType::Document.with_entity_str("entity_1"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "Hello via queue".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([recipient]),
    }
    .into_request()
    .with_conn_gateway();

    let result = ingress.send_notification(request).await.unwrap();

    // SqsNotificationIngress always returns Ok(None)
    assert!(result.is_none());

    // Verify message was published to the queue
    assert_eq!(queue.get_published_count(), 1);
}

#[tokio::test]
async fn test_process_from_queue_with_value_types() {
    let queue = Arc::new(MockQueue::new());
    let service =
        NotificationIngressService::new(MockRepository::new(), queue.clone(), MockStateMachine);

    let recipient = test_user_id("user@example.com");

    // Build a typed request, then type-erase it through IngressQueueMessage
    let typed_request = SendNotificationRequestBuilder {
        notification_entity: model_entity::EntityType::Document.with_entity_str("entity_1"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "Hello from queue".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([recipient.clone()]),
    }
    .into_request()
    .with_conn_gateway();

    let ingress_msg =
        crate::domain::models::queue_message::IngressQueueMessage::from_request(&typed_request)
            .unwrap();

    // Process the type-erased request
    let result = service
        .process_from_queue(ingress_msg.request)
        .await
        .unwrap()
        .unwrap();

    assert!(result.notified_recipients.contains(&recipient));

    // Verify a queue message was published to the delivery queue
    let published = queue.get_published();
    assert_eq!(published.len(), 1);
    assert!(published[0]["content"]["ConnGateway"].is_object());
}

impl NotificationSender for std::sync::Arc<TrackingMobileSender> {
    async fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        notification: &crate::domain::models::apple::APNSPushNotification<T>,
        attributes: &crate::domain::models::mobile::MessageAttributes,
    ) -> Result<String, Report> {
        (**self)
            .send_ios_push_notification(endpoint_arn, notification, attributes)
            .await
    }

    async fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        notification: &crate::domain::models::android::FCMMessage<T>,
        attributes: &crate::domain::models::mobile::MessageAttributes,
    ) -> Result<String, Report> {
        (**self)
            .send_android_push_notification(endpoint_arn, notification, attributes)
            .await
    }
}

// ============================================================================
// Egress Type-Disabled Digest Guard Tests
// ============================================================================

#[tokio::test]
async fn test_poll_email_digests_skips_publish_when_user_disabled_type() {
    use std::sync::Arc;

    let user = test_user_id("digest@macro.com");
    let notif = UserNotificationRow {
        owner_id: user.clone(),
        notification_id: Uuid::nil(),
        notification_event_type: "test_notification".to_string(),
        entity: EntityType::Document.with_entity_str("doc-1"),
        sent: false,
        state: crate::domain::models::NotificationState::Unseen,
        created_at: Utc::now(),
        viewed_at: None,
        updated_at: Utc::now(),
        deleted_at: None,
        notification_metadata: serde_json::to_value(TestNotification {
            message: "hello from digest".to_string(),
        })
        .unwrap(),
        sender_id: None,
    };

    let batch = DigestBatch {
        user_id: user.clone(),
        notifications: vec![notif.into_tagged()],
    };

    let batcher = ReadyDigestBatcher {
        batch: Mutex::new(Some(batch)),
    };

    let queue = Arc::new(MockQueue::new());
    let service = NotificationEgressService {
        queue: queue.clone(),
        repository: MockRepository::new().with_type_disabled_user(user),
        realtime: MockRealtimeSender,
        mobile: MockMobileSender,
        email: MockEmailSender,
        rate_limiter: allowing_rate_limiter(),
        state_machine: MockEgressStateMachine,
        digest_batcher: batcher,
    };

    fn digest_to_notif(batch: DigestBatch) -> Result<TestNotification, Report> {
        Ok(TestNotification {
            message: format!("You have {} notification(s)", batch.notifications.len()),
        })
    }

    let result = service.poll_email_digests(&digest_to_notif).await.unwrap();

    // Should still return Ready (batch was consumed) but nothing published
    assert!(matches!(result, ClaimResult::Ready(())));
    assert!(
        queue.get_published().is_empty(),
        "No message should be published when user has disabled the notification type"
    );
}

#[tokio::test]
async fn test_poll_email_digests_publishes_when_user_has_not_disabled_type() {
    use std::sync::Arc;

    let user = test_user_id("digest@macro.com");
    let other_user = test_user_id("other@macro.com");
    let notif = UserNotificationRow {
        owner_id: user.clone(),
        notification_id: Uuid::nil(),
        notification_event_type: "test_notification".to_string(),
        entity: EntityType::Document.with_entity_str("doc-1"),
        sent: false,
        state: crate::domain::models::NotificationState::Unseen,
        created_at: Utc::now(),
        viewed_at: None,
        updated_at: Utc::now(),
        deleted_at: None,
        notification_metadata: serde_json::to_value(TestNotification {
            message: "hello from digest".to_string(),
        })
        .unwrap(),
        sender_id: None,
    };

    let batch = DigestBatch {
        user_id: user.clone(),
        notifications: vec![notif.into_tagged()],
    };

    let batcher = ReadyDigestBatcher {
        batch: Mutex::new(Some(batch)),
    };

    let queue = Arc::new(MockQueue::new());
    // A different user has the type disabled, not the digest recipient
    let service = NotificationEgressService {
        queue: queue.clone(),
        repository: MockRepository::new().with_type_disabled_user(other_user),
        realtime: MockRealtimeSender,
        mobile: MockMobileSender,
        email: MockEmailSender,
        rate_limiter: allowing_rate_limiter(),
        state_machine: MockEgressStateMachine,
        digest_batcher: batcher,
    };

    fn digest_to_notif(batch: DigestBatch) -> Result<TestNotification, Report> {
        Ok(TestNotification {
            message: format!("You have {} notification(s)", batch.notifications.len()),
        })
    }

    let result = service.poll_email_digests(&digest_to_notif).await.unwrap();

    assert!(matches!(result, ClaimResult::Ready(())));
    let published = queue.get_published();
    assert_eq!(
        published.len(),
        1,
        "Message should be published when user has not disabled the type"
    );
    assert!(published[0]["content"]["Email"].is_object());
}
