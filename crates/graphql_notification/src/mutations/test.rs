use std::sync::{Arc, Mutex};

use async_graphql::{EmptySubscription, Object, Schema};
use chrono::Utc;
use model_entity::EntityType;
use notification::domain::models::request::NotificationStatus;
use serde_json::json;

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
}

impl NotificationMutationService for CapturingNotificationService {
    async fn update_notifications(
        &self,
        user_id: MacroUserIdStr<'static>,
        notification_ids: Vec<Uuid>,
        status: NotificationStatus,
    ) -> Result<Vec<UserNotificationRow<serde_json::Value>>, Report> {
        let operation = match status {
            NotificationStatus::Seen => "seen",
            NotificationStatus::Done(true) => "done",
            NotificationStatus::Done(false) => "undone",
        };
        self.calls
            .lock()
            .unwrap()
            .push((user_id.to_string(), notification_ids.clone(), operation));
        let now = Utc::now();
        Ok(notification_ids
            .into_iter()
            .map(|notification_id| UserNotificationRow {
                owner_id: user_id.clone(),
                notification_id,
                notification_event_type: "channel_message_send".to_string(),
                entity: EntityType::Channel.with_entity_string("channel-1".to_string()),
                sent: true,
                done: false,
                created_at: now,
                viewed_at: Some(now),
                updated_at: now,
                deleted_at: None,
                notification_metadata: json!({ "messageId": "message-1" }),
                sender_id: None,
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
            r#"mutation {{ updateNotifications(input: {{ notificationIds: ["{second}", "{first}"], operation: MARK_SEEN }}) {{ __typename id seen viewedAt }} }}"#
        ))
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["updateNotifications"][0]["__typename"],
        "GraphqlSoupNotification"
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
