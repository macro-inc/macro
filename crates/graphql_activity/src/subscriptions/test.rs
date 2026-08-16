use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use activity::{
    Action, Activity, ActivityRecord, ActivitySubscription, Actor, CommonAction, RecordedAction,
};
use async_graphql::{EmptyMutation, Object, Schema};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

use super::*;

struct Query;

#[Object]
impl Query {
    async fn value(&self) -> bool {
        true
    }
}

struct TestSubscriptionService {
    subscriptions: Mutex<VecDeque<ActivitySubscription>>,
}

impl ActivitySubscriptionService for TestSubscriptionService {
    fn subscribe(&self, _user_id: MacroUserIdStr<'static>) -> ActivitySubscription {
        self.subscriptions
            .lock()
            .expect("subscription lock")
            .pop_front()
            .expect("subscription opened once")
    }
}

fn subscription(
    exit: ActivitySubscriptionExit,
) -> (
    tokio::sync::mpsc::Sender<ActivitySubscriptionUpdate>,
    ActivitySubscription,
) {
    let (sender, receiver) = tokio::sync::mpsc::channel(1);
    let (exit_sender, exit_receiver) = tokio::sync::oneshot::channel();
    exit_sender.send(exit).expect("exit receiver remains open");
    (
        sender,
        ActivitySubscription::from_parts(receiver, exit_receiver),
    )
}

fn record(user_id: &MacroUserIdStr<'static>) -> ActivityRecord {
    let activity = Activity::common(
        Uuid::from_u128(7),
        0,
        Actor::new_from_user(user_id.clone()),
        None,
        EntityType::Document,
        "doc-1",
        CommonAction::Edited,
        Utc::now(),
    );
    ActivityRecord {
        id: activity.id,
        actor: activity.actor.clone(),
        subject_id: activity.subject_id.clone(),
        entity_type: activity.entity_type,
        entity_id: activity.entity_id.clone(),
        action: RecordedAction::Known(Action::Edited),
        occurred_at: activity.occurred_at,
    }
}

#[tokio::test]
async fn activity_updates_streams_recorded_events() {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap();
    let (sender, subscription) = subscription(ActivitySubscriptionExit::Closed);
    let service = TestSubscriptionService {
        subscriptions: Mutex::new(VecDeque::from([subscription])),
    };
    let schema = Schema::new(Query, EmptyMutation, ActivitySubscriptionRoot::new(service));
    let mut responses = Box::pin(schema.execute_stream(
        async_graphql::Request::new(
            "subscription { activityUpdates { __typename ... on GraphqlActivityEvent { id entityType entityId action { __typename } } } }",
        )
        .data(user_id.clone()),
    ));

    let record = record(&user_id);
    let record_id = record.id;
    sender
        .send(ActivitySubscriptionUpdate::Updated(Arc::new(record)))
        .await
        .expect("subscription remains open");

    let response = futures::StreamExt::next(&mut responses)
        .await
        .expect("subscription response");
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().expect("response data is JSON");
    assert_eq!(data["activityUpdates"]["id"], record_id.to_string());
    assert_eq!(data["activityUpdates"]["entityType"], "DOCUMENT");
    assert_eq!(data["activityUpdates"]["entityId"], "doc-1");
    assert_eq!(
        data["activityUpdates"]["action"]["__typename"],
        "GraphqlActivityEdited"
    );
}

#[tokio::test]
async fn activity_updates_streams_cache_deletions() {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap();
    let (sender, subscription) = subscription(ActivitySubscriptionExit::Closed);
    let service = TestSubscriptionService {
        subscriptions: Mutex::new(VecDeque::from([subscription])),
    };
    let schema = Schema::new(Query, EmptyMutation, ActivitySubscriptionRoot::new(service));
    let mut responses = Box::pin(schema.execute_stream(
        async_graphql::Request::new(
            "subscription { activityUpdates { __typename ... on GraphqlCacheDeletion { graphqlTypeName entityId } } }",
        )
        .data(user_id),
    ));

    let activity_id = Uuid::from_u128(42);
    sender
        .send(ActivitySubscriptionUpdate::Deleted(activity_id))
        .await
        .expect("subscription remains open");

    let response = futures::StreamExt::next(&mut responses)
        .await
        .expect("subscription response");
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().expect("response data is JSON");
    assert_eq!(
        data["activityUpdates"]["__typename"],
        "GraphqlCacheDeletion"
    );
    assert_eq!(
        data["activityUpdates"]["graphqlTypeName"],
        "GraphqlActivityEvent"
    );
    assert_eq!(data["activityUpdates"]["entityId"], activity_id.to_string());
}

#[tokio::test]
async fn activity_updates_reports_slow_consumers() {
    let user_id = MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap();
    let (sender, subscription) = subscription(ActivitySubscriptionExit::SlowConsumer);
    drop(sender);
    let service = TestSubscriptionService {
        subscriptions: Mutex::new(VecDeque::from([subscription])),
    };
    let schema = Schema::new(Query, EmptyMutation, ActivitySubscriptionRoot::new(service));
    let mut responses = Box::pin(
        schema.execute_stream(
            async_graphql::Request::new("subscription { activityUpdates { __typename } }")
                .data(user_id),
        ),
    );

    let response = futures::StreamExt::next(&mut responses)
        .await
        .expect("terminal error response");
    assert!(
        response
            .errors
            .iter()
            .any(|error| error.message.contains("too slow")),
        "{:?}",
        response.errors
    );
}

#[tokio::test]
async fn activity_updates_requires_an_authenticated_user() {
    let service = TestSubscriptionService {
        subscriptions: Mutex::new(VecDeque::new()),
    };
    let schema = Schema::new(Query, EmptyMutation, ActivitySubscriptionRoot::new(service));
    let mut responses = Box::pin(schema.execute_stream(async_graphql::Request::new(
        "subscription { activityUpdates { __typename } }",
    )));

    let response = futures::StreamExt::next(&mut responses)
        .await
        .expect("error response");
    assert!(!response.errors.is_empty());
}
