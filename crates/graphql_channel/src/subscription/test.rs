use std::sync::Mutex;

use activity::domain::timeline::TimelineActivity;
use async_graphql::{EmptyMutation, Object, Schema};
use chrono::DateTime;
use tokio::sync::{mpsc, oneshot};
use tokio_stream::StreamExt as _;
use uuid::Uuid;

use super::*;

const CHANNEL: Uuid = Uuid::from_u128(100);

/// Placeholder query root; subscriptions need one.
struct Query;
#[Object]
impl Query {
    /// Unused.
    async fn ok(&self) -> bool {
        true
    }
}

type Subscription = (
    mpsc::Sender<Arc<GraphqlChannelTimelineUpdate>>,
    oneshot::Sender<ExitReason>,
);

/// Hands out one prepared subscription and records who asked for it.
fn subscriptions() -> (
    ChannelTimelineSubscriptions,
    Arc<Mutex<Vec<String>>>,
    Subscription,
) {
    let (updates, receiver) = mpsc::channel(4);
    let (exit, exit_reason) = oneshot::channel();
    let prepared = Mutex::new(Some(BroadcastSubscription::from_parts(
        receiver,
        exit_reason,
    )));
    let asked = Arc::new(Mutex::new(Vec::new()));
    let subscriptions = ChannelTimelineSubscriptions::new({
        let asked = Arc::clone(&asked);
        move |user_id| {
            asked.lock().unwrap().push(user_id.as_ref().to_owned());
            prepared.lock().unwrap().take()
        }
    });
    (subscriptions, asked, (updates, exit))
}

fn update() -> Arc<GraphqlChannelTimelineUpdate> {
    GraphqlChannelTimelineUpdate::shared(ChannelTimelineUpdate::activity(
        CHANNEL,
        9_007_199_254_740_993,
        TimelineActivity {
            id: Uuid::from_u128(7),
            actor_id: "macro|author@example.com".into(),
            occurred_at: DateTime::from_timestamp(1_000, 0).unwrap(),
            action: "picture_changed".into(),
            payload: None,
        },
    ))
}

const SUBSCRIPTION: &str = "subscription { channelTimelineUpdates { channelId seq removedIds messages { id } activities { id action } } }";

fn schema(
    subscriptions: ChannelTimelineSubscriptions,
) -> Schema<Query, EmptyMutation, ChannelTimelineSubscriptionRoot> {
    Schema::build(Query, EmptyMutation, ChannelTimelineSubscriptionRoot)
        .data(subscriptions)
        .finish()
}

fn viewer() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap()
}

#[tokio::test]
async fn streams_the_viewers_updates_with_the_changes_page_shape() {
    let (subscriptions, asked, (updates, _exit)) = subscriptions();
    let schema = schema(subscriptions);
    let mut responses =
        schema.execute_stream(async_graphql::Request::new(SUBSCRIPTION).data(viewer()));

    updates.send(update()).await.unwrap();
    let response = responses.next().await.unwrap();
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["channelTimelineUpdates"],
        serde_json::json!({
            "channelId": CHANNEL.to_string(),
            "seq": "9007199254740993",
            "removedIds": [],
            "messages": [],
            "activities": [{ "id": Uuid::from_u128(7).to_string(), "action": "picture_changed" }],
        })
    );
    assert_eq!(*asked.lock().unwrap(), ["macro|viewer@example.com"]);
}

#[tokio::test]
async fn an_anonymous_request_is_refused_without_subscribing() {
    let (subscriptions, asked, _subscription) = subscriptions();
    let schema = schema(subscriptions);
    let response = schema
        .execute_stream(async_graphql::Request::new(SUBSCRIPTION))
        .next()
        .await
        .unwrap();
    assert_eq!(response.errors[0].message, "authentication required");
    assert!(asked.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_subscription_that_falls_behind_ends_with_an_error() {
    let (subscriptions, _, (updates, exit)) = subscriptions();
    let schema = schema(subscriptions);
    let mut responses =
        schema.execute_stream(async_graphql::Request::new(SUBSCRIPTION).data(viewer()));

    exit.send(ExitReason::SlowConsumer).unwrap();
    drop(updates);
    let response = responses.next().await.unwrap();
    assert!(
        response.errors[0].message.contains("fell behind"),
        "{:?}",
        response.errors
    );
    assert!(responses.next().await.is_none());
}
