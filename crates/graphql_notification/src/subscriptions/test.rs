use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use async_graphql::{EmptyMutation, Object, Schema};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::{NotifEvent, TaskAssignedMetadata};
use notification::domain::{
    models::{NotificationSubscriptionUpdate, UserNotificationRow},
    ports::{
        WebSocketNotificationSubscription, WebSocketNotificationSubscriptionExit,
        WebSocketNotificationSubscriptionService,
    },
};

use super::*;

struct Query;

#[Object]
impl Query {
    async fn value(&self) -> bool {
        true
    }
}

struct TestSubscriptionService {
    subscriptions: Mutex<
        VecDeque<WebSocketNotificationSubscription<NotificationSubscriptionUpdate<NotifEvent>>>,
    >,
}

impl WebSocketNotificationSubscriptionService<NotificationSubscriptionUpdate<NotifEvent>>
    for TestSubscriptionService
{
    fn subscribe(
        &self,
        _user_id: MacroUserIdStr<'static>,
    ) -> WebSocketNotificationSubscription<NotificationSubscriptionUpdate<NotifEvent>> {
        self.subscriptions
            .lock()
            .expect("subscription lock")
            .pop_front()
            .expect("subscription opened once")
    }
}

fn subscription(
    exit: WebSocketNotificationSubscriptionExit,
) -> (
    tokio::sync::mpsc::Sender<NotificationSubscriptionUpdate<NotifEvent>>,
    WebSocketNotificationSubscription<NotificationSubscriptionUpdate<NotifEvent>>,
) {
    let (sender, receiver) = tokio::sync::mpsc::channel(1);
    let (exit_sender, exit_receiver) = tokio::sync::oneshot::channel();
    exit_sender.send(exit).expect("exit receiver remains open");
    (
        sender,
        WebSocketNotificationSubscription::from_parts(receiver, exit_receiver),
    )
}

#[tokio::test]
async fn notification_updates_streams_realtime_notifications() {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap();
    let assigned_by = MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap();
    let (sender, subscription) = subscription(WebSocketNotificationSubscriptionExit::Closed);
    let service = TestSubscriptionService {
        subscriptions: Mutex::new(VecDeque::from([subscription])),
    };
    let schema = Schema::new(
        Query,
        EmptyMutation,
        NotificationSubscriptionRoot::new(service),
    );
    let mut responses = Box::pin(schema.execute_stream(
        async_graphql::Request::new(
            "subscription { notificationUpdates { __typename ... on GraphqlNotification { id eventType entityType entityId metadata { __typename ... on GraphqlTaskAssignedMetadata { taskId taskName assignedBy } } } } }",
        )
        .data(user_id.clone()),
    ));

    let notification_id = uuid::Uuid::from_u128(42);
    sender
        .send(NotificationSubscriptionUpdate::Updated(Arc::new(
            UserNotificationRow {
                owner_id: user_id,
                notification_id,
                notification_event_type: "task_assigned".to_string(),
                entity: EntityType::Document.with_entity_string("task-1".to_string()),
                sent: true,
                done: false,
                created_at: Utc::now(),
                viewed_at: None,
                updated_at: Utc::now(),
                deleted_at: None,
                notification_metadata: NotifEvent::TaskAssigned(TaskAssignedMetadata {
                    task_id: "task-1".to_string(),
                    task_name: Some("Test task".to_string()),
                    sub_type: None,
                    assigned_by,
                    sender_profile_picture_url: None,
                }),
                sender_id: None,
            },
        )))
        .await
        .expect("subscription remains open");

    let response = futures::StreamExt::next(&mut responses)
        .await
        .expect("subscription response");
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().expect("response data is JSON");
    assert_eq!(
        data["notificationUpdates"]["id"],
        notification_id.to_string()
    );
    assert_eq!(data["notificationUpdates"]["eventType"], "task_assigned");
    assert_eq!(data["notificationUpdates"]["entityType"], "DOCUMENT");
    assert_eq!(data["notificationUpdates"]["entityId"], "task-1");
    assert_eq!(
        data["notificationUpdates"]["metadata"]["__typename"],
        "GraphqlTaskAssignedMetadata"
    );
    assert_eq!(data["notificationUpdates"]["metadata"]["taskId"], "task-1");
    assert_eq!(
        data["notificationUpdates"]["metadata"]["taskName"],
        "Test task"
    );
    assert_eq!(
        data["notificationUpdates"]["metadata"]["assignedBy"],
        "macro|assigner@example.com"
    );
}

#[tokio::test]
async fn notification_updates_streams_cache_deletions() {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap();
    let (sender, subscription) = subscription(WebSocketNotificationSubscriptionExit::Closed);
    let service = TestSubscriptionService {
        subscriptions: Mutex::new(VecDeque::from([subscription])),
    };
    let schema = Schema::new(
        Query,
        EmptyMutation,
        NotificationSubscriptionRoot::new(service),
    );
    let mut responses = Box::pin(schema.execute_stream(
        async_graphql::Request::new(
            "subscription { notificationUpdates { __typename ... on GraphqlCacheDeletion { graphqlTypeName entityId } } }",
        )
        .data(user_id),
    ));

    let notification_id = uuid::Uuid::from_u128(42);
    sender
        .send(NotificationSubscriptionUpdate::Deleted(notification_id))
        .await
        .expect("subscription remains open");

    let response = futures::StreamExt::next(&mut responses)
        .await
        .expect("subscription response");
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().expect("response data is JSON");
    assert_eq!(
        data["notificationUpdates"]["__typename"],
        "GraphqlCacheDeletion"
    );
    assert_eq!(
        data["notificationUpdates"]["graphqlTypeName"],
        "GraphqlNotification"
    );
    assert_eq!(
        data["notificationUpdates"]["entityId"],
        notification_id.to_string()
    );
}

#[tokio::test]
async fn notification_updates_reports_slow_consumers() {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap();
    let (sender, subscription) = subscription(WebSocketNotificationSubscriptionExit::SlowConsumer);
    drop(sender);
    let service = TestSubscriptionService {
        subscriptions: Mutex::new(VecDeque::from([subscription])),
    };
    let schema = Schema::new(
        Query,
        EmptyMutation,
        NotificationSubscriptionRoot::new(service),
    );
    let mut responses = Box::pin(
        schema.execute_stream(
            async_graphql::Request::new("subscription { notificationUpdates { __typename } }")
                .data(user_id),
        ),
    );

    let response = futures::StreamExt::next(&mut responses)
        .await
        .expect("terminal subscription response");
    assert_eq!(
        response.errors[0].message,
        "notification subscription closed because the client was too slow"
    );
}

#[tokio::test]
async fn notification_updates_requires_an_authenticated_user() {
    let service = TestSubscriptionService {
        subscriptions: Mutex::new(VecDeque::new()),
    };
    let schema = Schema::new(
        Query,
        EmptyMutation,
        NotificationSubscriptionRoot::new(service),
    );
    let mut responses =
        Box::pin(schema.execute_stream("subscription { notificationUpdates { __typename } }"));

    let response = futures::StreamExt::next(&mut responses)
        .await
        .expect("subscription response");
    assert_eq!(response.errors[0].message, "authentication required");
}
