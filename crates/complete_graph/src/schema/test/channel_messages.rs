use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};

use activity::domain::timeline::{
    ActivityTimeline, ActivityTimelineLookup, ActivityTimelineQuery, TimelineActivity,
    TimelineReadError,
};
use async_graphql::Variables;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use graphql_channel::messages::ChannelMessagesGraphqlContext;
use macro_authorization::{CredentialOrigin, MacroAuthorization, MacroUserAuthentication};
use messages::{
    domain::{
        ports::{MessageEvent, MessageEventPublisher},
        service::MessageService,
    },
    outbound::pg_message_repo::PgMessageRepository,
};
use serde_json::{Value, json};
use sqlx::PgPool;

use super::*;

/// The fixture's channel owner, who the harness authenticates for reads.
const AUTHOR: &str = VALID_USER_ID;
const MEMBER: &str = "macro|member@example.com";
const OUTSIDER: &str = "macro|outsider@example.com";
const CHANNEL: Uuid = Uuid::from_u128(0xa1);
const OTHER_CHANNEL: Uuid = Uuid::from_u128(0xb1);

/// The events the message service published, as realtime receives them.
#[derive(Clone, Default)]
struct PublishedEvents(Arc<Mutex<Vec<MessageEvent>>>);

impl MessageEventPublisher for PublishedEvents {
    async fn publish(&self, event: MessageEvent) -> Result<(), Report> {
        self.0.lock().unwrap().push(event);
        Ok(())
    }
}

impl PublishedEvents {
    fn count(&self) -> usize {
        self.0.lock().unwrap().len()
    }

    /// The sequence number the last event carried.
    fn last_seq(&self) -> Value {
        json!(self.0.lock().unwrap().last().expect("an event").seq)
    }
}

/// A timeline with no facts between its messages.
struct NoActivities;

type ActivityRead<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<TimelineActivity>, TimelineReadError>> + Send + 'a>>;

impl ActivityTimeline for NoActivities {
    fn read<'a>(&'a self, _: ActivityTimelineQuery) -> ActivityRead<'a> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn read_by_ids<'a>(&'a self, _: ActivityTimelineLookup) -> ActivityRead<'a> {
        Box::pin(async { Ok(Vec::new()) })
    }
}

/// The composed schema over the real message and access services, as the
/// document storage service builds it.
struct ChannelWrites {
    harness: TestHarness,
    context: ChannelMessagesGraphqlContext,
    events: PublishedEvents,
}

fn channel_writes(pool: &PgPool) -> ChannelWrites {
    let events = PublishedEvents::default();
    let service = Arc::new(
        MessageService::new(PgMessageRepository::new(pool.clone()), events.clone())
            .with_activity(NoActivities),
    );
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    ChannelWrites {
        harness: harness(),
        context: ChannelMessagesGraphqlContext::new(service, access),
        events,
    }
}

fn session(user: &'static str) -> MacroAuthorization {
    MacroAuthorization::User(MacroUserAuthentication {
        origin: CredentialOrigin::Session,
        agent_id: None,
        agent_via: None,
        macro_user_id: MacroUserIdStr::parse_from_str(user).unwrap(),
        user_context: UserContext {
            user_id: user.to_owned(),
            ..UserContext::default()
        },
    })
}

impl ChannelWrites {
    async fn write(
        &self,
        caller: &'static str,
        field: &str,
        input: Value,
    ) -> async_graphql::Response {
        let input_type = match field {
            "postChannelMessage" => "GraphqlChannelPostMessageInput",
            "editChannelMessage" => "GraphqlChannelEditMessageInput",
            "deleteChannelMessage" => "GraphqlChannelDeleteMessageInput",
            _ => "GraphqlChannelReactInput",
        };
        let mutation = format!(
            "mutation($input: {input_type}!) {{ {field}(input: $input) {{
                seq
                message {{
                    id channelId threadId senderId content deletedAt
                    reactions {{ emoji users }}
                    thread {{ replyCount }}
                    call {{ state }}
                }}
            }} }}"
        );
        self.harness
            .schema
            .execute(
                self.harness
                    .request(&mutation, authenticated_parts())
                    .variables(Variables::from_json(json!({ "input": input })))
                    .data(self.context.with_caller(session(caller))),
            )
            .await
    }

    /// A write that must succeed: its payload.
    async fn written(&self, caller: &'static str, field: &str, input: Value) -> Value {
        let response = self.write(caller, field, input).await;
        assert!(response.errors.is_empty(), "{field}: {:?}", response.errors);
        response.data.into_json().unwrap()[field].clone()
    }

    /// A write that must be refused: its code.
    async fn refused(&self, caller: &'static str, field: &str, input: Value) -> Value {
        let response = self.write(caller, field, input).await;
        assert_eq!(response.errors.len(), 1, "{field}: {:?}", response.errors);
        serde_json::to_value(&response.errors[0]).unwrap()["extensions"]["code"].clone()
    }

    /// The author's view of the channel: its latest page and what changed
    /// after `since`.
    async fn read(&self, since: i64) -> Value {
        let query = format!(
            "{{ user {{ channelMessages(channelId: \"{CHANNEL}\") {{
                timeline {{ seq entries {{ ... on GraphqlChannelMessage {{ id content }} }} }}
                changes(since: {since}) {{ seq entries {{ ... on GraphqlChannelMessage {{ id }} }} replies {{ id }} }}
            }} }} }}"
        );
        let response = self
            .harness
            .schema
            .execute(
                self.harness
                    .request(&query, authenticated_parts())
                    .data(self.context.clone()),
            )
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        response.data.into_json().unwrap()["user"]["channelMessages"].clone()
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_messages"))
)]
async fn each_channel_message_write_returns_its_message_and_its_events_sequence_number(
    pool: PgPool,
) {
    let writes = channel_writes(&pool);
    let root_id = Uuid::now_v7();

    let root = writes
        .written(
            AUTHOR,
            "postChannelMessage",
            json!({ "channelId": CHANNEL, "id": root_id, "content": "root", "nonce": "n-1" }),
        )
        .await;
    assert_eq!(root["seq"], writes.events.last_seq());
    assert!(root["seq"].is_i64());
    assert_eq!(root["message"]["id"], json!(root_id));
    assert_eq!(root["message"]["senderId"], AUTHOR);

    let reply = writes
        .written(
            MEMBER,
            "postChannelMessage",
            json!({ "channelId": CHANNEL, "threadId": root_id, "content": "reply" }),
        )
        .await;
    assert_eq!(reply["seq"], writes.events.last_seq());
    assert_eq!(reply["message"]["threadId"], json!(root_id));
    let reply_id = reply["message"]["id"].clone();

    // A write returns the message it wrote, never read again: a root that
    // now has a reply still comes back without its thread.
    let reacted_root = writes
        .written(
            MEMBER,
            "reactToChannelMessage",
            json!({ "channelId": CHANNEL, "messageId": root_id, "emoji": "+1", "add": true }),
        )
        .await;
    assert_eq!(reacted_root["seq"], writes.events.last_seq());
    assert_eq!(reacted_root["message"]["id"], json!(root_id));
    assert_eq!(reacted_root["message"]["thread"], Value::Null);
    assert_eq!(reacted_root["message"]["call"], Value::Null);

    let edited = writes
        .written(
            MEMBER,
            "editChannelMessage",
            json!({ "channelId": CHANNEL, "messageId": reply_id, "content": "edited" }),
        )
        .await;
    assert_eq!(edited["seq"], writes.events.last_seq());
    assert_eq!(edited["message"]["content"], "edited");

    let reaction = json!({
        "channelId": CHANNEL, "messageId": reply_id, "emoji": "+1", "add": true,
    });
    let reacted = writes
        .written(AUTHOR, "reactToChannelMessage", reaction.clone())
        .await;
    assert_eq!(reacted["seq"], writes.events.last_seq());
    assert_eq!(
        reacted["message"]["reactions"],
        json!([{ "emoji": "+1", "users": [AUTHOR] }])
    );
    let published = writes.events.count();
    let again = writes
        .written(AUTHOR, "reactToChannelMessage", reaction)
        .await;
    assert_eq!(again["seq"], Value::Null);
    assert_eq!(
        again["message"]["reactions"],
        reacted["message"]["reactions"]
    );
    assert_eq!(writes.events.count(), published);

    let deletion = json!({ "channelId": CHANNEL, "messageId": reply_id });
    let deleted = writes
        .written(MEMBER, "deleteChannelMessage", deletion.clone())
        .await;
    assert_eq!(deleted["seq"], writes.events.last_seq());
    assert!(deleted["message"]["deletedAt"].is_string());
    let published = writes.events.count();
    // A resent delete finds the tombstone and succeeds without writing.
    let replayed = writes
        .written(MEMBER, "deleteChannelMessage", deletion)
        .await;
    assert_eq!(replayed["seq"], Value::Null);
    assert_eq!(replayed["message"]["id"], reply_id);
    assert_eq!(
        replayed["message"]["deletedAt"],
        deleted["message"]["deletedAt"]
    );
    assert_eq!(writes.events.count(), published);

    // The numbers the writes returned are the channel's.
    assert_eq!(
        writes.read(0).await["timeline"]["seq"],
        writes.events.last_seq()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_messages"))
)]
async fn a_resent_post_returns_the_committed_message_and_writes_nothing(pool: PgPool) {
    let writes = channel_writes(&pool);
    let id = Uuid::now_v7();

    let posted = writes
        .written(
            AUTHOR,
            "postChannelMessage",
            json!({ "channelId": CHANNEL, "id": id, "content": "once" }),
        )
        .await;
    let seq = posted["seq"].as_i64().unwrap();

    let replayed = writes
        .written(
            AUTHOR,
            "postChannelMessage",
            json!({ "channelId": CHANNEL, "id": id, "content": "twice" }),
        )
        .await;
    assert_eq!(replayed["seq"], Value::Null);
    assert_eq!(replayed["message"], posted["message"]);
    assert_eq!(writes.events.count(), 1);

    let read = writes.read(seq).await;
    assert_eq!(read["timeline"]["seq"], seq);
    assert_eq!(
        read["timeline"]["entries"],
        json!([{ "id": id, "content": "once" }])
    );
    assert_eq!(
        read["changes"],
        json!({ "seq": seq, "entries": [], "replies": [] })
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_messages"))
)]
async fn channel_message_writes_refuse_outsiders_and_ids_held_elsewhere(pool: PgPool) {
    let writes = channel_writes(&pool);
    let id = Uuid::now_v7();

    assert_eq!(
        writes
            .refused(
                OUTSIDER,
                "postChannelMessage",
                json!({ "channelId": CHANNEL, "id": id, "content": "let me in" }),
            )
            .await,
        "FORBIDDEN"
    );
    writes
        .written(
            AUTHOR,
            "postChannelMessage",
            json!({ "channelId": CHANNEL, "id": id, "content": "mine" }),
        )
        .await;

    // The id names a message in another channel, or another sender's.
    assert_eq!(
        writes
            .refused(
                AUTHOR,
                "postChannelMessage",
                json!({ "channelId": OTHER_CHANNEL, "id": id, "content": "moved" }),
            )
            .await,
        "CONFLICT"
    );
    assert_eq!(
        writes
            .refused(
                MEMBER,
                "postChannelMessage",
                json!({ "channelId": CHANNEL, "id": id, "content": "taken" }),
            )
            .await,
        "CONFLICT"
    );
    for (field, input) in [
        (
            "editChannelMessage",
            json!({ "channelId": CHANNEL, "messageId": id, "content": "theirs" }),
        ),
        (
            "deleteChannelMessage",
            json!({ "channelId": CHANNEL, "messageId": id }),
        ),
        (
            "reactToChannelMessage",
            json!({ "channelId": CHANNEL, "messageId": id, "emoji": "+1", "add": true }),
        ),
    ] {
        assert_eq!(
            writes.refused(OUTSIDER, field, input).await,
            "FORBIDDEN",
            "{field}"
        );
    }
    assert_eq!(writes.events.count(), 1);
}
