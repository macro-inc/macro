use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use notification::domain::models::UserNotificationRow;
use serde_json::json;

use super::GraphqlSoupNotification;

struct Query {
    notification: GraphqlSoupNotification,
}

#[Object]
impl Query {
    async fn notification(&self) -> &GraphqlSoupNotification {
        &self.notification
    }
}

fn notification(metadata: serde_json::Value) -> GraphqlSoupNotification {
    UserNotificationRow {
        owner_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
        notification_id: uuid::Uuid::from_u128(1),
        notification_event_type: "unknown_notification".to_string(),
        entity: EntityType::Document.with_entity_string("document-1".to_string()),
        sent: true,
        done: false,
        created_at: Utc::now(),
        viewed_at: None,
        updated_at: Utc::now(),
        deleted_at: None,
        notification_metadata: metadata,
        sender_id: None,
    }
    .into()
}

#[tokio::test]
async fn malformed_typed_metadata_is_nullable_and_returns_a_client_safe_error() {
    let schema = Schema::new(
        Query {
            notification: notification(json!({"secret": "do not expose"})),
        },
        EmptyMutation,
        EmptySubscription,
    );

    let response = schema
        .execute("{ notification { id typedMetadata { __typename } } }")
        .await;

    assert_eq!(response.errors.len(), 1);
    assert_eq!(
        response.errors[0].message,
        "notification metadata is unavailable"
    );
    assert!(!response.errors[0].message.contains("unknown_notification"));
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["notification"]["id"],
        uuid::Uuid::from_u128(1).to_string()
    );
    assert!(data["notification"]["typedMetadata"].is_null());
}
