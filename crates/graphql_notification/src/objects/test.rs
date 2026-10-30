use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::TaskAssignedMetadata;
use notification::domain::models::UserNotificationRow;
use serde_json::json;

use super::GraphqlNotification;

struct Query {
    notification: GraphqlNotification,
}

#[Object]
impl Query {
    async fn notification(&self) -> &GraphqlNotification {
        &self.notification
    }
}

fn raw_notification(metadata: serde_json::Value) -> UserNotificationRow<serde_json::Value> {
    UserNotificationRow {
        owner_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
        notification_id: uuid::Uuid::from_u128(1),
        notification_event_type: "task_assigned".to_string(),
        entity: EntityType::Document.with_entity_string("document-1".to_string()),
        sent: true,
        state: notification::domain::models::NotificationState::Unseen,
        created_at: Utc::now(),
        viewed_at: None,
        updated_at: Utc::now(),
        deleted_at: None,
        notification_metadata: metadata,
        sender_id: None,
    }
}

#[tokio::test]
async fn metadata_is_the_typed_notification_union() {
    let assigned_by = MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap();
    let metadata = TaskAssignedMetadata {
        task_id: "task-1".to_string(),
        task_name: Some("Test task".to_string()),
        sub_type: None,
        assigned_by,
        sender_profile_picture_url: None,
    };
    let notification =
        GraphqlNotification::try_from(raw_notification(serde_json::to_value(metadata).unwrap()))
            .unwrap();
    assert!(matches!(&notification, GraphqlNotification::Owned(_)));

    let schema = Schema::new(Query { notification }, EmptyMutation, EmptySubscription);

    let response = schema
        .execute(
            "{ notification { metadata { __typename ... on GraphqlTaskAssignedMetadata { taskId taskName assignedBy } } } }",
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["notification"]["metadata"]["__typename"],
        "GraphqlTaskAssignedMetadata"
    );
    assert_eq!(data["notification"]["metadata"]["taskId"], "task-1");
    assert_eq!(data["notification"]["metadata"]["taskName"], "Test task");
    assert_eq!(
        data["notification"]["metadata"]["assignedBy"],
        "macro|assigner@example.com"
    );
}

#[tokio::test]
async fn group_access_notifications_retain_the_canonical_entity_identity() {
    let metadata = model_notifications::EntityAccessGrantedMetadata {
        request_id: uuid::Uuid::from_u128(2),
        revision: 1,
        entity_name: "Escalations".into(),
        file_type: None,
        access_level: model_notifications::RequestedAccessLevel::View,
    };
    let mut row = raw_notification(serde_json::to_value(metadata).unwrap());
    row.notification_event_type = "entity_access_granted".into();
    row.entity = EntityType::ExternalChat.with_entity_string("group-1".into());
    let notification = GraphqlNotification::try_from(row).unwrap();
    let schema = Schema::new(Query { notification }, EmptyMutation, EmptySubscription);
    let response = schema
        .execute("{ notification { targetEntityType entityId eventType } }")
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap(),
        json!({
            "notification": { "targetEntityType": "EXTERNAL_CHAT", "entityId": "group-1", "eventType": "entity_access_granted" }
        })
    );
    assert!(graphql_common::GraphqlSoupEntityType::try_new(EntityType::ExternalChat).is_none());
}

#[test]
fn malformed_metadata_is_rejected_before_graphql_resolution() {
    let error = GraphqlNotification::try_from(raw_notification(json!({"secret": "do not expose"})))
        .err()
        .expect("malformed metadata must fail conversion");

    assert!(!error.to_string().is_empty());
}
