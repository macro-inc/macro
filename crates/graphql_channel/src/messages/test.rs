use std::sync::{Arc, Mutex};

use activity::domain::timeline::TimelineActivity;
use async_graphql::{EmptyMutation, EmptySubscription, Request, Schema};
use channel_sender::ChannelSender;
use chrono::{DateTime, TimeZone, Utc};
use messages::domain::{
    models::{
        BotSenderProfile, CountedReaction, ImportedAuthor, Message, MessageAttachment, MessageKind,
        MessageListItem, MessageParent, MessageThreadPreview, SimpleMention, ThreadState,
    },
    ports::{
        CallEntryStatus, MessageCursor, MessageDirection, MessageError, MessageTimelineEntry,
        MessageTimelinePage, MessageTimelineQuery, ReplyCursor, ThreadRepliesPage,
        ThreadRepliesQuery,
    },
    service::changes::ChannelChanges,
};
use serde_json::{Value, json};
use uuid::Uuid;

use super::{
    ChannelMessagesGraphqlContext, GraphqlChannelMessagesQuery, encode_cursor,
    reads::{ChannelMessageReads, ReadFuture, Reader, SequencedThreadPage, SequencedTimelinePage},
};

mod writes;

const USER: &str = "macro|reader@example.com";
const CHANNEL: Uuid = Uuid::from_u128(20);

fn at(second: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 12, 9, 0, second).unwrap()
        + chrono::Duration::microseconds(123_456)
}

fn message(id: u128, thread: Option<u128>) -> Message {
    Message {
        id: Uuid::from_u128(id),
        parent: MessageParent::Channel(CHANNEL),
        thread_id: thread.map(Uuid::from_u128),
        kind: MessageKind::Message,
        sender_id: ChannelSender::try_from(USER.to_owned()).unwrap(),
        guest_name: Some("Guest".into()),
        imported_author: Some(ImportedAuthor {
            name: "Imported".into(),
        }),
        bot_profile: Some(BotSenderProfile {
            name: "Persona".into(),
            avatar_url: Some("https://example.com/a.png".into()),
        }),
        mentions: vec![SimpleMention {
            entity_type: "user".into(),
            entity_id: USER.into(),
        }],
        triggered_by: Some(USER.into()),
        triggered_via: Some("client".into()),
        content: format!("message {id}"),
        created_at: at(1),
        updated_at: at(2),
        edited_at: Some(at(2)),
        deleted_at: None,
        attachments: vec![MessageAttachment {
            id: Uuid::from_u128(900 + id),
            entity_type: "document".into(),
            entity_id: "doc".into(),
            width: Some(640),
            height: None,
            created_at: at(1),
        }],
        reactions: vec![CountedReaction {
            emoji: "+1".into(),
            users: vec![USER.into()],
            names: None,
        }],
    }
}

fn root(id: u128) -> MessageListItem {
    MessageListItem {
        message: message(id, None),
        state: ThreadState {
            root_id: Uuid::from_u128(id),
            user_id: USER.into(),
            resolved: true,
            anchor: None,
            created_at: at(1),
            updated_at: at(3),
            deleted_at: Some(at(4)),
        },
        thread: MessageThreadPreview {
            reply_count: 7,
            latest_reply_at: Some(at(5)),
            preview: vec![message(id + 100, Some(id))],
        },
    }
}

fn activity(id: u128) -> TimelineActivity {
    TimelineActivity {
        id: Uuid::from_u128(id),
        actor_id: USER.into(),
        occurred_at: at(6),
        action: "renamed".into(),
        payload: Some(json!({ "from": "a", "to": "b" })),
    }
}

fn page() -> MessageTimelinePage {
    let mut call = root(3);
    call.message.kind = MessageKind::CallRoot;
    MessageTimelinePage {
        entries: vec![
            MessageTimelineEntry::Message {
                message: Box::new(root(1)),
            },
            MessageTimelineEntry::Activity {
                activity: activity(2),
            },
            MessageTimelineEntry::Call {
                message: Box::new(call),
                status: CallEntryStatus::Ended {
                    ended_at: at(7),
                    duration_ms: 61_000,
                },
            },
            MessageTimelineEntry::Call {
                message: Box::new(root(4)),
                status: CallEntryStatus::Live,
            },
        ],
        next_cursor: Some(MessageCursor {
            created_at: at(1),
            id: Uuid::from_u128(1),
        }),
        previous_cursor: None,
    }
}

#[derive(Default)]
struct FakeReads {
    page: Option<MessageTimelinePage>,
    changes: ChannelChanges,
    failure: Mutex<Option<MessageError>>,
    timelines: Mutex<Vec<(Reader, Uuid, MessageTimelineQuery)>>,
    since: Mutex<Vec<(Uuid, i64)>>,
    threads: Mutex<Vec<(Uuid, Uuid, ThreadRepliesQuery)>>,
}

impl ChannelMessageReads for FakeReads {
    fn timeline(
        &self,
        reader: Reader,
        channel_id: Uuid,
        query: MessageTimelineQuery,
    ) -> ReadFuture<'_, SequencedTimelinePage> {
        Box::pin(async move {
            self.timelines
                .lock()
                .unwrap()
                .push((reader, channel_id, query));
            if let Some(error) = self.failure.lock().unwrap().take() {
                return Err(error);
            }
            Ok(SequencedTimelinePage {
                seq: 41,
                page: self.page.clone().unwrap_or(MessageTimelinePage {
                    entries: vec![],
                    next_cursor: None,
                    previous_cursor: None,
                }),
            })
        })
    }

    fn thread(
        &self,
        _: Reader,
        channel_id: Uuid,
        root_id: Uuid,
        query: ThreadRepliesQuery,
    ) -> ReadFuture<'_, SequencedThreadPage> {
        Box::pin(async move {
            let starts_thread = query.cursor.is_none();
            self.threads
                .lock()
                .unwrap()
                .push((channel_id, root_id, query));
            let item = root(1);
            Ok(SequencedThreadPage {
                seq: 41,
                root: starts_thread.then(|| MessageTimelineEntry::Message {
                    message: Box::new(item.clone()),
                }),
                page: ThreadRepliesPage {
                    state: item.state,
                    root: item.message,
                    replies: vec![message(101, Some(1)), message(102, Some(1))],
                    older_cursor: Some(reply_cursor()),
                    newer_cursor: None,
                },
            })
        })
    }

    fn changes(&self, _: Reader, channel_id: Uuid, since: i64) -> ReadFuture<'_, ChannelChanges> {
        Box::pin(async move {
            self.since.lock().unwrap().push((channel_id, since));
            Ok(self.changes.clone())
        })
    }
}

async fn run(reads: Arc<FakeReads>, query: &str) -> async_graphql::Response {
    let user = graphql_common::parse_macro_user_id(USER.to_owned(), "user").unwrap();
    Schema::build(
        GraphqlChannelMessagesQuery::new(user),
        EmptyMutation,
        EmptySubscription,
    )
    .finish()
    .execute(
        Request::new(query).data(
            ChannelMessagesGraphqlContext::from_ports(
                reads,
                Arc::new(writes::FakeWrites::default()),
            )
            .for_organization(Some(7)),
        ),
    )
    .await
}

const MESSAGE_FIELDS: &str = "id channelId threadId kind senderId guestName
    importedAuthor { name } botProfile { name avatarUrl }
    mentions { entityType entityId } triggeredBy triggeredVia content
    createdAt updatedAt editedAt deletedAt
    attachments { attachmentId entityType entityId width height createdAt }
    reactions { emoji users }";

fn timeline_query(arguments: &str) -> String {
    let arguments = arguments
        .strip_prefix(", ")
        .map(|arguments| format!("({arguments})"))
        .unwrap_or_default();
    format!(
        "{{ channelMessages(channelId: \"{CHANNEL}\") {{ id timeline{arguments} {{
            seq olderCursor {{ createdAt entryId }} newerCursor {{ createdAt entryId }}
            entries {{
                __typename
                ... on GraphqlChannelMessage {{
                    {MESSAGE_FIELDS}
                    thread {{ userId resolved createdAt updatedAt deletedAt replyCount
                        latestReplyAt preview {{ {MESSAGE_FIELDS} thread {{ replyCount }} call {{ state }} }} }}
                    call {{ state endedAt durationMs }}
                }}
                ... on GraphqlChannelTimelineActivity {{ id actorId occurredAt action payload }}
            }}
        }} }} }}"
    )
}

/// The REST spelling of a GraphQL message, field for field.
fn rest_message(message: &Value) -> Value {
    json!({
        "id": message["id"],
        "parent": serde_json::to_value(MessageParent::Channel(
            message["channelId"].as_str().unwrap().parse().unwrap(),
        ))
        .unwrap(),
        "thread_id": message["threadId"],
        "kind": match message["kind"].as_str().unwrap() {
            "MESSAGE" => serde_json::to_value(MessageKind::Message).unwrap(),
            _ => serde_json::to_value(MessageKind::CallRoot).unwrap(),
        },
        "sender_id": message["senderId"],
        "guest_name": message["guestName"],
        "imported_author": message["importedAuthor"],
        "bot_profile": match &message["botProfile"] {
            Value::Null => Value::Null,
            profile => json!({ "name": profile["name"], "avatar_url": profile["avatarUrl"] }),
        },
        "mentions": message["mentions"].as_array().unwrap().iter().map(|mention| json!({
            "entity_type": mention["entityType"], "entity_id": mention["entityId"],
        })).collect::<Vec<_>>(),
        "triggered_by": message["triggeredBy"],
        "triggered_via": message["triggeredVia"],
        "content": message["content"],
        "created_at": message["createdAt"],
        "updated_at": message["updatedAt"],
        "edited_at": message["editedAt"],
        "deleted_at": message["deletedAt"],
        "attachments": message["attachments"].as_array().unwrap().iter().map(|attachment| json!({
            "id": attachment["attachmentId"],
            "entity_type": attachment["entityType"],
            "entity_id": attachment["entityId"],
            "width": attachment["width"],
            "height": attachment["height"],
            "created_at": attachment["createdAt"],
        })).collect::<Vec<_>>(),
        "reactions": message["reactions"],
    })
}

/// The REST spelling of a GraphQL timeline entry.
fn rest_entry(entry: &Value) -> Value {
    if entry["__typename"] == "GraphqlChannelTimelineActivity" {
        return json!({ "type": "activity", "activity": {
            "id": entry["id"],
            "actor_id": entry["actorId"],
            "occurred_at": entry["occurredAt"],
            "action": entry["action"],
            "payload": entry["payload"],
        }});
    }
    let thread = &entry["thread"];
    let mut item = rest_message(entry);
    item["state"] = json!({
        "root_id": entry["id"],
        "user_id": thread["userId"],
        "resolved": thread["resolved"],
        "anchor": null,
        "created_at": thread["createdAt"],
        "updated_at": thread["updatedAt"],
        "deleted_at": thread["deletedAt"],
    });
    item["thread"] = json!({
        "reply_count": thread["replyCount"],
        "latest_reply_at": thread["latestReplyAt"],
        "preview": thread["preview"].as_array().unwrap().iter().map(rest_message).collect::<Vec<_>>(),
    });
    match &entry["call"] {
        Value::Null => json!({ "type": "message", "message": item }),
        call => {
            let status = match call["state"].as_str().unwrap() {
                "LIVE" => json!({ "state": "live" }),
                "ENDED" => json!({
                    "state": "ended",
                    "ended_at": call["endedAt"],
                    "duration_ms": call["durationMs"],
                }),
                _ => json!({ "state": "record_deleted" }),
            };
            json!({ "type": "call", "message": item, "status": status })
        }
    }
}

#[tokio::test]
async fn a_timeline_page_carries_every_value_the_rest_route_returns() {
    let reads = Arc::new(FakeReads {
        page: Some(page()),
        ..FakeReads::default()
    });
    let response = run(reads.clone(), &timeline_query("")).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let read = &data["channelMessages"]["timeline"];
    let rest = serde_json::to_value(page()).unwrap();
    let entries: Vec<Value> = read["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(rest_entry)
        .collect();
    assert_eq!(Value::Array(entries), rest["entries"]);
    assert_eq!(read["seq"], 41);
    // The cursor is the REST cursor, field for field.
    assert_eq!(
        json!({
            "created_at": read["olderCursor"]["createdAt"],
            "id": read["olderCursor"]["entryId"],
        }),
        rest["next_cursor"]
    );
    assert_eq!(read["newerCursor"], Value::Null);
    // Replies in a preview are not roots.
    let preview = &read["entries"][0]["thread"]["preview"][0];
    assert_eq!(preview["thread"], Value::Null);
    assert_eq!(preview["call"], Value::Null);

    let (reader, channel_id, query) = reads.timelines.lock().unwrap().remove(0);
    assert_eq!(reader.user_id.as_ref(), USER);
    assert_eq!(reader.organization_id, Some(7));
    assert_eq!(channel_id, CHANNEL);
    assert!(query.cursor.is_none() && query.around.is_none() && query.limit.is_none());
    assert_eq!(query.direction, MessageDirection::Older);
}

#[tokio::test]
async fn a_cursor_a_page_returned_reads_the_next_page() {
    let reads = Arc::new(FakeReads::default());
    let cursor = serde_json::to_value(MessageCursor {
        created_at: at(1),
        id: Uuid::from_u128(1),
    })
    .unwrap();
    let arguments = format!(
        ", input: {{ cursor: {{ createdAt: {}, entryId: {} }}, direction: NEWER, limit: 100 }}",
        cursor["created_at"], cursor["id"]
    );
    let response = run(reads.clone(), &timeline_query(&arguments)).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let (_, _, query) = reads.timelines.lock().unwrap().remove(0);
    let read = query.cursor.unwrap();
    assert_eq!((read.created_at, read.id), (at(1), Uuid::from_u128(1)));
    assert_eq!(query.direction, MessageDirection::Newer);
    assert_eq!(query.limit, Some(100));

    let around = format!(", input: {{ around: \"{}\" }}", Uuid::from_u128(9));
    run(reads.clone(), &timeline_query(&around)).await;
    let (_, _, query) = reads.timelines.lock().unwrap().remove(0);
    assert_eq!(query.around, Some(Uuid::from_u128(9)));
}

#[tokio::test]
async fn input_the_reads_would_reject_never_reaches_them() {
    let reads = Arc::new(FakeReads::default());
    for arguments in [
        ", input: { limit: 0 }",
        ", input: { limit: 101 }",
        ", input: { cursor: { createdAt: \"yesterday\", entryId: \"00000000-0000-0000-0000-000000000001\" } }",
        ", input: { cursor: { createdAt: \"2026-01-01T00:00:00Z\", entryId: \"not an id\" } }",
        ", input: { around: \"not an id\" }",
    ] {
        let response = run(reads.clone(), &timeline_query(arguments)).await;
        assert_eq!(response.errors.len(), 1, "{arguments}");
    }
    assert!(reads.timelines.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_failed_read_reports_its_kind_and_hides_its_cause() {
    for (error, code, message) in [
        (MessageError::Forbidden, "FORBIDDEN", "forbidden"),
        (
            MessageError::NotFound,
            "NOT_FOUND",
            "channel or message not found",
        ),
        (
            MessageError::Invalid("around and cursor cannot be combined"),
            "BAD_USER_INPUT",
            "around and cursor cannot be combined",
        ),
        (
            MessageError::Repository(rootcause::report!("database host db-7 refused")),
            "INTERNAL_SERVER_ERROR",
            "channel messages are unavailable",
        ),
    ] {
        let reads = Arc::new(FakeReads::default());
        *reads.failure.lock().unwrap() = Some(error);
        let response = run(reads, &timeline_query("")).await;
        let error = serde_json::to_value(&response.errors[0]).unwrap();
        assert_eq!(error["message"], message);
        assert_eq!(error["extensions"]["code"], code);
    }
}

#[tokio::test]
async fn changes_after_a_number_carry_the_current_state_and_what_is_gone() {
    let reads = Arc::new(FakeReads {
        changes: ChannelChanges {
            reset: false,
            seq: 12,
            has_more: true,
            entries: vec![MessageTimelineEntry::Message {
                message: Box::new(root(1)),
            }],
            replies: vec![message(101, Some(1))],
            activities: vec![activity(2)],
            removed: vec![Uuid::from_u128(5)],
        },
        ..FakeReads::default()
    });
    let query = format!(
        "{{ channelMessages(channelId: \"{CHANNEL}\") {{ changes(since: 9) {{
            reset seq hasMore removed
            entries {{ ... on GraphqlChannelMessage {{ id thread {{ replyCount }} }} }}
            replies {{ id threadId thread {{ replyCount }} }}
            activities {{ id action }}
        }} }} }}"
    );
    let response = run(reads.clone(), &query).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["channelMessages"]["changes"],
        json!({
            "reset": false,
            "seq": 12,
            "hasMore": true,
            "removed": [Uuid::from_u128(5)],
            "entries": [{ "id": Uuid::from_u128(1), "thread": { "replyCount": 7 } }],
            "replies": [{
                "id": Uuid::from_u128(101),
                "threadId": Uuid::from_u128(1),
                "thread": null,
            }],
            "activities": [{ "id": Uuid::from_u128(2), "action": "renamed" }],
        })
    );
    assert_eq!(*reads.since.lock().unwrap(), [(CHANNEL, 9)]);
}

fn reply_cursor() -> ReplyCursor {
    ReplyCursor {
        import_order: Some(3),
        created_at: at(1),
        id: Uuid::from_u128(101),
    }
}

fn thread_query(arguments: &str) -> String {
    format!(
        "{{ channelMessages(channelId: \"{CHANNEL}\") {{ thread(rootId: \"{}\"{arguments}) {{
            seq rootId olderCursor newerCursor
            root {{ id thread {{ replyCount resolved }} }}
            replies {{ {MESSAGE_FIELDS} thread {{ replyCount }} }}
        }} }} }}",
        Uuid::from_u128(1)
    )
}

#[tokio::test]
async fn an_opening_thread_window_carries_the_root_and_a_continued_one_does_not() {
    let reads = Arc::new(FakeReads::default());
    let response = run(reads.clone(), &thread_query("")).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let read = &data["channelMessages"]["thread"];
    assert_eq!(read["seq"], 41);
    assert_eq!(read["rootId"], json!(Uuid::from_u128(1)));
    assert_eq!(
        read["root"],
        json!({ "id": Uuid::from_u128(1), "thread": { "replyCount": 7, "resolved": true } })
    );
    let replies: Vec<Value> = read["replies"]
        .as_array()
        .unwrap()
        .iter()
        .map(rest_message)
        .collect();
    assert_eq!(
        Value::Array(replies),
        serde_json::to_value([message(101, Some(1)), message(102, Some(1))]).unwrap()
    );
    assert_eq!(read["replies"][0]["thread"], Value::Null);
    let older = read["olderCursor"].as_str().unwrap().to_owned();
    assert_eq!(older, encode_cursor(reply_cursor()));
    assert_eq!(read["newerCursor"], Value::Null);

    let arguments = format!(", input: {{ cursor: \"{older}\", direction: NEWER, limit: 20 }}");
    let response = run(reads.clone(), &thread_query(&arguments)).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["channelMessages"]["thread"]["root"],
        Value::Null
    );
    let calls = reads.threads.lock().unwrap();
    assert_eq!((calls[0].0, calls[0].1), (CHANNEL, Uuid::from_u128(1)));
    assert!(calls[0].2.cursor.is_none() && calls[0].2.around.is_none());
    assert_eq!(calls[1].2.cursor, Some(reply_cursor()));
    assert_eq!(calls[1].2.direction, MessageDirection::Newer);
    assert_eq!(calls[1].2.limit, Some(20));
}
