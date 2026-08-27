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

fn task_assignment(
    owner_id: MacroUserIdStr<'static>,
    notification_id: uuid::Uuid,
) -> UserNotificationRow<NotifEvent> {
    UserNotificationRow {
        owner_id,
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
            assigned_by: MacroUserIdStr::parse_from_str("macro|assigner@example.com").unwrap(),
            sender_profile_picture_url: None,
        }),
        sender_id: None,
    }
}

#[tokio::test]
async fn notification_updates_streams_new_notifications() {
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
            "subscription { notificationUpdates { __typename ... on GraphqlNewNotification { notification { id eventType entityType entityId metadata { __typename ... on GraphqlTaskAssignedMetadata { taskId taskName assignedBy } } } } } }",
        )
        .data(user_id.clone()),
    ));

    let notification_id = uuid::Uuid::from_u128(42);
    sender
        .send(NotificationSubscriptionUpdate::New(Arc::new(
            task_assignment(user_id, notification_id),
        )))
        .await
        .expect("subscription remains open");

    let response = futures::StreamExt::next(&mut responses)
        .await
        .expect("subscription response");
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().expect("response data is JSON");
    let update = &data["notificationUpdates"];
    let notification = &update["notification"];
    assert_eq!(update["__typename"], "GraphqlNewNotification");
    assert_eq!(notification["id"], notification_id.to_string());
    assert_eq!(notification["eventType"], "task_assigned");
    assert_eq!(notification["entityType"], "DOCUMENT");
    assert_eq!(notification["entityId"], "task-1");
    assert_eq!(
        notification["metadata"]["__typename"],
        "GraphqlTaskAssignedMetadata"
    );
    assert_eq!(notification["metadata"]["taskId"], "task-1");
    assert_eq!(notification["metadata"]["taskName"], "Test task");
    assert_eq!(
        notification["metadata"]["assignedBy"],
        "macro|assigner@example.com"
    );
}

#[tokio::test]
async fn notification_updates_streams_updated_notifications() {
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
            "subscription { notificationUpdates { __typename ... on GraphqlUpdatedNotification { notification { id done viewedAt } } } }",
        )
        .data(user_id.clone()),
    ));

    let notification_id = uuid::Uuid::from_u128(43);
    sender
        .send(NotificationSubscriptionUpdate::Updated(Arc::new(
            task_assignment(user_id, notification_id),
        )))
        .await
        .expect("subscription remains open");

    let response = futures::StreamExt::next(&mut responses)
        .await
        .expect("subscription response");
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().expect("response data is JSON");
    let update = &data["notificationUpdates"];
    assert_eq!(update["__typename"], "GraphqlUpdatedNotification");
    assert_eq!(update["notification"]["id"], notification_id.to_string());
    assert_eq!(update["notification"]["done"], false);
    assert_eq!(update["notification"]["viewedAt"], serde_json::Value::Null);
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
