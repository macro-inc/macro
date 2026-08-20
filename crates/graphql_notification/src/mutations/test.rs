use std::sync::{Arc, Mutex};

use async_graphql::{EmptySubscription, Object, Schema};
use chrono::Utc;
use model_entity::{Entity, EntityType};
use model_notifications::{
    ChannelMessageSendMetadata, ChannelType, CommonChannelMetadata, NotifEvent,
};
use notification::domain::models::request::NotificationStatus;

use super::*;

struct QueryRoot;

#[Object]
impl QueryRoot {
    async fn health(&self) -> bool {
        true
    }
}

#[derive(Default)]
struct CapturingNotificationService {
    calls: Mutex<Vec<(String, Vec<Uuid>, &'static str)>>,
    entity_calls: Mutex<Vec<(String, Vec<(EntityType, String)>, &'static str)>>,
}

fn operation_name(status: &NotificationStatus) -> &'static str {
    match status {
        NotificationStatus::Seen => "seen",
        NotificationStatus::Done(true) => "done",
        NotificationStatus::Done(false) => "undone",
    }
}

fn notification_row(
    user_id: MacroUserIdStr<'static>,
    notification_id: Uuid,
    entity: Entity<'static>,
    status: &NotificationStatus,
) -> UserNotificationRow<NotifEvent> {
    let now = Utc::now();
    UserNotificationRow {
        owner_id: user_id,
        notification_id,
        notification_event_type: "channel_message_send".to_string(),
        entity,
        sent: true,
        done: matches!(status, NotificationStatus::Done(true)),
        created_at: now,
        viewed_at: matches!(status, NotificationStatus::Seen).then_some(now),
        updated_at: now,
        deleted_at: None,
        notification_metadata: NotifEvent::ChannelMessageSend(ChannelMessageSendMetadata {
            sender: None,
            sender_display_name: None,
            message_content: "Test message".to_string(),
            message_id: "message-1".to_string(),
            has_attachments: false,
            common: CommonChannelMetadata {
                channel_type: ChannelType::Public,
                channel_name: "Test channel".to_string(),
            },
            sender_profile_picture_url: None,
        }),
        sender_id: None,
    }
}

impl NotificationMutationService for CapturingNotificationService {
    async fn update_notifications(
        &self,
        user_id: MacroUserIdStr<'static>,
        notification_ids: Vec<Uuid>,
        status: NotificationStatus,
    ) -> Result<Vec<UserNotificationRow<NotifEvent>>, Report> {
        let operation = operation_name(&status);
        self.calls
            .lock()
            .unwrap()
            .push((user_id.to_string(), notification_ids.clone(), operation));
        Ok(notification_ids
            .into_iter()
            .map(|notification_id| {
                notification_row(
                    user_id.clone(),
                    notification_id,
                    EntityType::Channel.with_entity_string("channel-1".to_string()),
                    &status,
                )
            })
            .collect())
    }

    async fn update_notifications_for_entities(
        &self,
        user_id: MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
        status: NotificationStatus,
    ) -> Result<Vec<UserNotificationRow<NotifEvent>>, Report> {
        let operation = operation_name(&status);
        self.entity_calls.lock().unwrap().push((
            user_id.to_string(),
            entities
                .iter()
                .map(|entity| (entity.entity_type, entity.entity_id.to_string()))
                .collect(),
            operation,
        ));
        Ok(entities
            .into_iter()
            .enumerate()
            .map(|(index, entity)| {
                notification_row(
                    user_id.clone(),
                    Uuid::from_u128(index as u128 + 1),
                    entity,
                    &status,
                )
            })
            .collect())
    }
}

#[test]
fn notification_operations_map_to_explicit_domain_statuses() {
    assert!(matches!(
        NotificationStatus::from(GraphqlNotificationUpdateOperation::MarkSeen),
        NotificationStatus::Seen
    ));
    assert!(matches!(
        NotificationStatus::from(GraphqlNotificationUpdateOperation::MarkDone),
        NotificationStatus::Done(true)
    ));
    assert!(matches!(
        NotificationStatus::from(GraphqlNotificationUpdateOperation::MarkUndone),
        NotificationStatus::Done(false)
    ));
}

#[tokio::test]
async fn update_notifications_maps_operation_and_returns_normalized_rows_in_order() {
    let service = Arc::new(CapturingNotificationService::default());
    let user = MacroUserIdStr::try_from_email("user@example.com").unwrap();
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let schema = Schema::build(
        QueryRoot,
        NotificationMutationRoot::<CapturingNotificationService>::new(),
        EmptySubscription,
    )
    .data(service.clone())
    .data(user)
    .finish();

    let response = schema
        .execute(format!(
            r#"mutation {{ updateNotifications(input: {{ notificationIds: ["{second}", "{first}"], operation: MARK_SEEN }}) {{ __typename id seen viewedAt metadata {{ __typename }} }} }}"#
        ))
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["updateNotifications"][0]["__typename"],
        "GraphqlNotification"
    );
    assert_eq!(
        data["updateNotifications"][0]["metadata"]["__typename"],
        "GraphqlChannelMessageSendMetadata"
    );
    assert_eq!(data["updateNotifications"][0]["id"], second.to_string());
    assert_eq!(data["updateNotifications"][1]["id"], first.to_string());
    assert_eq!(
        service.calls.lock().unwrap().as_slice(),
        [(
            "macro|user@example.com".to_string(),
            vec![second, first],
            "seen",
        ),]
    );
}

#[tokio::test]
async fn update_notifications_for_entity_maps_entities_and_operation() {
    let service = Arc::new(CapturingNotificationService::default());
    let user = MacroUserIdStr::try_from_email("entity-user@example.com").unwrap();
    let schema = Schema::build(
        QueryRoot,
        NotificationMutationRoot::<CapturingNotificationService>::new(),
        EmptySubscription,
    )
    .data(service.clone())
    .data(user)
    .finish();

    let response = schema
        .execute(
            r#"mutation {
                updateNotificationsForEntity(input: {
                    entities: [
                        { entityType: DOCUMENT, entityId: "document-1" },
                        { entityType: CHANNEL_MESSAGE, entityId: "message-1" }
                    ],
                    operation: MARK_DONE
                }) {
                    id
                    done
                    entityType
                    entityId
                }
            }"#,
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["updateNotificationsForEntity"][0]["id"],
        Uuid::from_u128(1).to_string()
    );
    assert_eq!(data["updateNotificationsForEntity"][0]["done"], true);
    assert_eq!(
        data["updateNotificationsForEntity"][0]["entityType"],
        "DOCUMENT"
    );
    assert_eq!(
        data["updateNotificationsForEntity"][0]["entityId"],
        "document-1"
    );
    assert_eq!(
        data["updateNotificationsForEntity"][1]["entityType"],
        "CHANNEL_MESSAGE"
    );
    assert_eq!(
        data["updateNotificationsForEntity"][1]["entityId"],
        "message-1"
    );
    assert_eq!(
        service.entity_calls.lock().unwrap().as_slice(),
        [(
            "macro|entity-user@example.com".to_string(),
            vec![
                (EntityType::Document, "document-1".to_string()),
                (EntityType::ChannelMessage, "message-1".to_string()),
            ],
            "done",
        )]
    );
}
