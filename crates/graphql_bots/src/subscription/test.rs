use std::sync::{Arc, Mutex};

use async_graphql::{EmptyMutation, Object, Schema, value};
use bots::domain::{
    bot_updates::{BotUpdateSubscription, BotUpdateSubscriptions, BotUpdatesExit},
    models::{BotId, BotIdentity},
};
use futures::StreamExt as _;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{BotUpdatesGraphqlContext, BotsSubscriptionRoot};

const VIEWER: &str = "macro|viewer@example.com";

fn viewer() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(VIEWER).unwrap()
}

fn identity(n: u128, name: &str) -> BotIdentity {
    BotIdentity {
        id: BotId::new_from_uuid(Uuid::from_u128(n)),
        name: name.to_string(),
        handle: name.to_lowercase(),
        avatar_url: None,
        deleted_at: None,
        is_system: false,
    }
}

/// Hands every subscriber the same buffered identities, then ends the way
/// `exit` says.
struct Buffered {
    identities: Vec<BotIdentity>,
    exit: BotUpdatesExit,
    subscribers: Mutex<Vec<String>>,
}

impl BotUpdateSubscriptions for Buffered {
    fn subscribe(&self, user_id: MacroUserIdStr<'static>) -> BotUpdateSubscription {
        self.subscribers.lock().unwrap().push(user_id.to_string());
        let (sender, receiver) = tokio::sync::mpsc::channel(self.identities.len().max(1));
        for identity in &self.identities {
            sender.try_send(identity.clone()).unwrap();
        }
        let (exit_sender, exit_reason) = tokio::sync::oneshot::channel();
        let _ = exit_sender.send(self.exit);
        BotUpdateSubscription::from_parts(receiver, exit_reason)
    }
}

struct Query;

#[Object]
impl Query {
    async fn ok(&self) -> bool {
        true
    }
}

async fn run(subscriptions: Arc<Buffered>, signed_in: bool) -> Vec<async_graphql::Response> {
    let schema = Schema::new(Query, EmptyMutation, BotsSubscriptionRoot);
    let mut request = async_graphql::Request::new("subscription { botUpdates { id name } }")
        .data(BotUpdatesGraphqlContext::new(subscriptions));
    if signed_in {
        request = request.data(viewer());
    }
    schema.execute_stream(request).collect().await
}

#[tokio::test]
async fn buffered_changes_arrive_as_one_batch_with_each_bot_once_as_it_now_is() {
    let subscriptions = Arc::new(Buffered {
        identities: vec![
            identity(1, "Scout"),
            identity(2, "Herald"),
            identity(1, "Ship Scout"),
        ],
        exit: BotUpdatesExit::Closed,
        subscribers: Mutex::default(),
    });

    let responses = run(Arc::clone(&subscriptions), true).await;

    assert_eq!(responses.len(), 1);
    assert!(responses[0].errors.is_empty(), "{:?}", responses[0].errors);
    assert_eq!(
        responses[0].data,
        value!({ "botUpdates": [
            { "id": "00000000-0000-0000-0000-000000000002", "name": "Herald" },
            { "id": "00000000-0000-0000-0000-000000000001", "name": "Ship Scout" }
        ] })
    );
    assert_eq!(*subscriptions.subscribers.lock().unwrap(), vec![VIEWER]);
}

#[tokio::test]
async fn a_subscriber_that_fell_behind_is_told_to_resubscribe() {
    let subscriptions = Arc::new(Buffered {
        identities: vec![identity(1, "Scout")],
        exit: BotUpdatesExit::SlowConsumer,
        subscribers: Mutex::default(),
    });

    let responses = run(subscriptions, true).await;

    assert_eq!(responses.len(), 2);
    assert!(responses[0].errors.is_empty(), "{:?}", responses[0].errors);
    assert_eq!(
        responses[1].errors[0].message,
        "bot updates fell behind; resubscribe and refetch"
    );
}

#[tokio::test]
async fn bot_updates_require_a_signed_in_user() {
    let subscriptions = Arc::new(Buffered {
        identities: vec![identity(1, "Scout")],
        exit: BotUpdatesExit::Closed,
        subscribers: Mutex::default(),
    });

    let responses = run(Arc::clone(&subscriptions), false).await;

    assert_eq!(responses.len(), 1);
    assert!(!responses[0].errors.is_empty());
    assert!(subscriptions.subscribers.lock().unwrap().is_empty());
}
