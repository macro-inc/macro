use activity::outbound::pg_activity_repo::PgActivityRepo;
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use graphql_channel::ChannelGraphqlContext;
use messages::domain::{
    models::{Message as ChannelMessage, MessageKind, MessageThreadPreview, ThreadState},
    ports::{
        CallEntryStatus, MessageCursor, MessageDirection, MessageThreadQuery, MessageTimelineEntry,
        MessageTimelinePage, MessageTimelineQuery, NoMessageEventPublisher,
    },
    service::{MessageService, MessageView},
};
use messages::outbound::pg_message_repo::PgMessageRepository;
use serde_json::{Value, json};
use sqlx::PgPool;

use super::*;

mod changes;
mod writes;

const CHANNEL_ID: Uuid = Uuid::from_u128(0x01900000000070008000000000000001);
const OTHER_CHANNEL_ID: Uuid = Uuid::from_u128(0x01900000000070008000000000000002);
const BOT_ID: Uuid = Uuid::from_u128(0x01900000000070008000000000000003);

type Reads = MessageService<PgMessageRepository, NoMessageEventPublisher>;

fn message_id(index: u128) -> Uuid {
    Uuid::from_u128(0x01900000000070008000000000001000 + index)
}

fn timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn timeline_key(created_at: DateTime<Utc>, id: Uuid) -> String {
    format!("{:020}-{id}", created_at.timestamp_micros())
}

fn message_key(message: &ChannelMessage) -> String {
    let position = timeline_key(message.created_at, message.id);
    if message.thread_id.is_some() {
        match message.import_order {
            Some(order) => format!("{order:020}-{position}"),
            None => format!("~-{position}"),
        }
    } else {
        position
    }
}

fn scalar_selection() -> &'static str {
    "__typename id channelId threadId kind sortKey senderId guestName importedAuthorName
     botProfile { name avatarUrl } mentions { entityType entityId }
     triggeredBy triggeredVia content createdAt updatedAt editedAt deletedAt
     attachments { attachmentId entityType entityId width height createdAt }
     reactions { emoji users } call { state endedAt durationMs }"
}

pub(super) fn message_selection() -> String {
    format!(
        "{} thread {{ resolved deletedAt createdAt updatedAt userId replyCount latestReplyAt
            preview {{ {} thread {{ resolved }} }} }}",
        scalar_selection(),
        scalar_selection(),
    )
}

fn expected_message(
    message: &ChannelMessage,
    thread: Option<(&ThreadState, &MessageThreadPreview)>,
    call: Option<CallEntryStatus>,
) -> Value {
    let call = call.map(|status| match status {
        CallEntryStatus::Live => json!({
            "state": "LIVE", "endedAt": null, "durationMs": null,
        }),
        CallEntryStatus::Ended {
            ended_at,
            duration_ms,
        } => json!({
            "state": "ENDED", "endedAt": timestamp(ended_at), "durationMs": duration_ms as f64,
        }),
        CallEntryStatus::RecordDeleted => json!({
            "state": "RECORD_DELETED", "endedAt": null, "durationMs": null,
        }),
    });
    json!({
        "__typename": "GraphqlChannelMessage",
        "id": message.id.to_string(),
        "channelId": message.parent.entity_id(),
        "threadId": message.thread_id.map(|id| id.to_string()),
        "kind": match message.kind { MessageKind::Message => "MESSAGE", MessageKind::CallRoot => "CALL_ROOT" },
        "sortKey": message_key(message),
        "senderId": message.sender_id.as_ref(),
        "guestName": message.guest_name,
        "importedAuthorName": message.imported_author.as_ref().map(|author| &author.name),
        "botProfile": message.bot_profile.as_ref().map(|profile| json!({
            "name": profile.name, "avatarUrl": profile.avatar_url,
        })),
        "mentions": message.mentions.iter().map(|mention| json!({
            "entityType": mention.entity_type, "entityId": mention.entity_id,
        })).collect::<Vec<_>>(),
        "triggeredBy": message.triggered_by,
        "triggeredVia": message.triggered_via,
        "content": message.content,
        "createdAt": timestamp(message.created_at),
        "updatedAt": timestamp(message.updated_at),
        "editedAt": message.edited_at.map(timestamp),
        "deletedAt": message.deleted_at.map(timestamp),
        "attachments": message.attachments.iter().map(|attachment| json!({
            "attachmentId": attachment.id.to_string(), "entityType": attachment.entity_type,
            "entityId": attachment.entity_id, "width": attachment.width, "height": attachment.height,
            "createdAt": timestamp(attachment.created_at),
        })).collect::<Vec<_>>(),
        "reactions": message.reactions.iter().map(|reaction| json!({
            "emoji": reaction.emoji, "users": reaction.users,
        })).collect::<Vec<_>>(),
        "thread": thread.map(|(state, preview)| json!({
            "resolved": state.resolved,
            "deletedAt": state.deleted_at.map(timestamp),
            "createdAt": timestamp(state.created_at),
            "updatedAt": timestamp(state.updated_at),
            "userId": state.user_id,
            "replyCount": preview.reply_count,
            "latestReplyAt": preview.latest_reply_at.map(timestamp),
            "preview": preview.preview.iter().map(|reply| expected_message(reply, None, None)).collect::<Vec<_>>(),
        })),
        "call": call,
    })
}

fn expected_entry(entry: &MessageTimelineEntry) -> Value {
    match entry {
        MessageTimelineEntry::Message { message } => expected_message(
            &message.message,
            Some((&message.state, &message.thread)),
            None,
        ),
        MessageTimelineEntry::Call { message, status } => expected_message(
            &message.message,
            Some((&message.state, &message.thread)),
            Some(*status),
        ),
        MessageTimelineEntry::Activity { activity } => json!({
            "__typename": "GraphqlChannelTimelineActivity", "id": activity.id.to_string(),
            "channelId": CHANNEL_ID.to_string(), "sortKey": timeline_key(activity.occurred_at, activity.id),
            "actorId": activity.actor_id, "occurredAt": timestamp(activity.occurred_at),
            "action": activity.action, "payload": activity.payload,
        }),
    }
}

fn expected_timeline(page: &MessageTimelinePage) -> Value {
    json!({
        "entries": page.entries.iter().map(expected_entry).collect::<Vec<_>>(),
        "olderCursor": page.next_cursor.as_ref().map(|cursor| timeline_key(cursor.created_at, cursor.id)),
        "newerCursor": page.previous_cursor.as_ref().map(|cursor| timeline_key(cursor.created_at, cursor.id)),
        "seq": "0",
    })
}

fn access() -> EntityAccessReceipt<MessageView> {
    EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::parse_from_str(VALID_USER_ID).expect("valid fixture user"),
        entity_access::domain::models::Entity {
            entity_id: CHANNEL_ID.to_string(),
            entity_type: EntityType::Channel,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .expect("fixture viewer has channel access")
}

async fn fixture(pool: PgPool) -> Arc<Reads> {
    let user_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id)
         VALUES ($1, 'channel-parity', 'user@example.com', 'channel-parity')",
        user_id,
    )
    .execute(&pool)
    .await
    .expect("seed account");
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, 'user@example.com', $2)"#,
        VALID_USER_ID,
        user_id,
    )
    .execute(&pool)
    .await
    .expect("seed user");
    for id in [CHANNEL_ID, OTHER_CHANNEL_ID] {
        sqlx::query!(
            "INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'private', $2)",
            id,
            VALID_USER_ID,
        )
        .execute(&pool)
        .await
        .expect("seed channel");
    }
    sqlx::query!(
        "INSERT INTO bots (id, kind, owner_user_id, name, handle, avatar_url, deleted_at)
         VALUES ($1, 'owned', $2, 'Archived helper', 'channel-parity-helper', 'https://example.com/avatar.png', now())",
        BOT_ID, VALID_USER_ID,
    ).execute(&pool).await.expect("seed historical bot profile");

    let base = DateTime::parse_from_rfc3339("2026-10-06T12:00:00.123456Z")
        .expect("fixture timestamp")
        .with_timezone(&Utc);
    // Roots 11 and 12 share a timestamp, so UUIDs must break the tie.
    for index in 1..=12u128 {
        let id = message_id(index);
        let at =
            base + Duration::seconds(i64::try_from(index.min(11)).expect("small fixture index"));
        let sender = if index == 6 {
            format!("bot|{BOT_ID}")
        } else {
            VALID_USER_ID.to_owned()
        };
        let kind = if (8..=10).contains(&index) {
            "call_root"
        } else {
            "message"
        };
        let content = format!("root {index}");
        sqlx::query!(
            "INSERT INTO comms_messages
             (id, parent_entity_type, parent_entity_id, sender_id, content, created_at, updated_at, kind)
             VALUES ($1, 'channel', $2, $3, $4, $5, $5, $6)",
            id, CHANNEL_ID.to_string(), sender, content, at, kind,
        ).execute(&pool).await.expect("seed root");
    }
    // Imported positions deliberately disagree with chronological order; nulls sort last.
    for (index, order) in [
        None,
        Some(2i64),
        Some(0),
        Some(1),
        Some(1),
        None,
        None,
        None,
        None,
        None,
        None,
    ]
    .into_iter()
    .enumerate()
    {
        let id = message_id(100 + index as u128);
        let at = base + Duration::seconds(20 + ((index + 1) / 2) as i64);
        let imported_author = order.map(|_| "Imported author");
        let content = format!("reply {index}");
        sqlx::query!(
            "INSERT INTO comms_messages
             (id, parent_entity_type, parent_entity_id, thread_id, sender_id, content,
              imported_author, import_order, created_at, updated_at)
             VALUES ($1, 'channel', $2, $3, $4, $5, $6, $7, $8, $8)",
            id,
            CHANNEL_ID.to_string(),
            message_id(2),
            VALID_USER_ID,
            content,
            imported_author,
            order,
            at,
        )
        .execute(&pool)
        .await
        .expect("seed ordered reply");
    }
    for root in [3u128, 4] {
        sqlx::query!(
            "INSERT INTO comms_messages
             (id, parent_entity_type, parent_entity_id, thread_id, sender_id, content, created_at, updated_at)
             VALUES ($1, 'channel', $2, $3, $4, 'surviving reply', $5, $5)",
            message_id(200 + root), CHANNEL_ID.to_string(), message_id(root), VALID_USER_ID, base,
        ).execute(&pool).await.expect("seed tombstone thread reply");
    }
    sqlx::query!(
        "UPDATE comms_messages SET content = '', deleted_at = $2,
         updated_at = $2::timestamp AT TIME ZONE 'UTC'
         WHERE id = ANY($1)",
        &[
            message_id(3),
            message_id(4),
            message_id(5),
            message_id(105),
            message_id(204)
        ],
        (base + Duration::minutes(1)).naive_utc(),
    )
    .execute(&pool)
    .await
    .expect("seed message tombstones");
    sqlx::query!(
        "UPDATE comms_message_threads SET deleted_at = $2, updated_at = $2 WHERE root_id = $1",
        message_id(4),
        base + Duration::minutes(1),
    )
    .execute(&pool)
    .await
    .expect("seed whole thread deletion");
    sqlx::query!(
        "UPDATE comms_message_threads SET resolved = true, updated_at = $2 WHERE root_id = $1",
        message_id(2),
        base + Duration::seconds(55),
    )
    .execute(&pool)
    .await
    .expect("seed resolved thread");
    sqlx::query!(
        "UPDATE comms_messages SET triggered_by_user_id = $2, triggered_via = 'Fixture client',
         edited_at = $3, updated_at = $3::timestamp AT TIME ZONE 'UTC' WHERE id = $1",
        message_id(6),
        VALID_USER_ID,
        (base + Duration::seconds(40)).naive_utc(),
    )
    .execute(&pool)
    .await
    .expect("seed attribution and edit");
    sqlx::query!(
        "INSERT INTO comms_attachments (id, message_id, entity_type, entity_id, width, height, created_at)
         VALUES ($1, $2, 'document', 'fixture-document', 640, 480, $3)",
        message_id(500), message_id(2), base + Duration::microseconds(7),
    ).execute(&pool).await.expect("seed attachment");
    for (index, entity_type, entity_id) in [
        (0u128, "user", VALID_USER_ID),
        (1, "document", "fixture-document"),
    ] {
        sqlx::query!(
            "INSERT INTO comms_entity_mentions (id, source_entity_type, source_entity_id, entity_type, entity_id, user_id)
             VALUES ($1, 'message', $2, $3, $4, $5)",
            message_id(510 + index), message_id(2).to_string(), entity_type, entity_id, VALID_USER_ID,
        ).execute(&pool).await.expect("seed mention");
    }
    for (emoji, user) in [
        ("👍", VALID_USER_ID),
        ("👍", "macro|reactor@example.com"),
        ("🎉", VALID_USER_ID),
    ] {
        sqlx::query!(
            "INSERT INTO comms_reactions (message_id, emoji, user_id) VALUES ($1, $2, $3)",
            message_id(2),
            emoji,
            user,
        )
        .execute(&pool)
        .await
        .expect("seed reaction");
    }
    for (index, action, payload) in [
        (
            0u128,
            "renamed",
            Some(json!({"old_name": "Before", "new_name": "After"})),
        ),
        (
            1,
            "participant_added",
            Some(json!({"user_id": VALID_USER_ID})),
        ),
        (2, "picture_changed", None),
        (3, "messaged", None), // Recorded activity omitted from the channel's selected vocabulary.
    ] {
        sqlx::query!(
            "INSERT INTO activity_events (id, actor_id, subject_id, action, action_payload, entity_type, entity_id, occurred_at)
             VALUES ($1, $2, $2, $3, $4, 'channel', $5, $6)",
            message_id(600 + index), VALID_USER_ID, action, payload,
            CHANNEL_ID.to_string(), base + Duration::seconds(3 + index as i64),
        ).execute(&pool).await.expect("seed timeline activity");
    }
    for index in [8u128, 9] {
        let permission_id = message_id(700 + index).to_string();
        sqlx::query!(
            r#"INSERT INTO "SharePermission" (id) VALUES ($1)"#,
            permission_id
        )
        .execute(&pool)
        .await
        .expect("seed call permission");
        let ended_at = (index == 8).then_some(base + Duration::minutes(3));
        sqlx::query!(
            "INSERT INTO call_entities (id, user_id, created_via, channel_id, share_permission_id, started_at, ended_at, duration_ms)
             VALUES ($1, $2, 'native', $3, $4, $5, $6, $7)",
            message_id(index), VALID_USER_ID, CHANNEL_ID, permission_id, base,
            ended_at, ended_at.map(|_| 180_000i64),
        ).execute(&pool).await.expect("seed call state");
    }
    Arc::new(
        MessageService::new(
            PgMessageRepository::new(pool.clone()),
            NoMessageEventPublisher,
        )
        .with_activity(PgActivityRepo::new(pool)),
    )
}

fn context(harness: &TestHarness, reads: &Arc<Reads>) -> ChannelGraphqlContext {
    harness
        .state
        .entity_access
        .viewable_channels
        .lock()
        .expect("channel access lock")
        .insert(CHANNEL_ID);
    ChannelGraphqlContext::new(Arc::clone(reads), Arc::clone(&harness.state.entity_access))
}

async fn execute(harness: &TestHarness, context: &ChannelGraphqlContext, field: &str) -> Value {
    let response = harness
        .schema
        .execute(
            harness
                .request(&format!("{{ user {{ {field} }} }}"), authenticated_parts())
                .data(context.clone()),
        )
        .await;
    assert!(
        response.errors.is_empty(),
        "{}: {:?}",
        field,
        response.errors
    );
    response.data.into_json().expect("GraphQL JSON")["user"].clone()
}

async fn timeline(
    harness: &TestHarness,
    context: &ChannelGraphqlContext,
    reads: &Reads,
    query: MessageTimelineQuery,
) -> (Value, MessageTimelinePage) {
    let mut input = format!(
        "channelId: \"{CHANNEL_ID}\", limit: {}",
        query.limit.unwrap_or(50)
    );
    if let Some(cursor) = &query.cursor {
        let name = if query.direction == MessageDirection::Older {
            "before"
        } else {
            "after"
        };
        input.push_str(&format!(
            ", {name}: \"{}\"",
            timeline_key(cursor.created_at, cursor.id)
        ));
    }
    if let Some(id) = query.around {
        input.push_str(&format!(", around: \"{id}\""));
    }
    let data = execute(harness, context, &format!(
        "channelTimeline(input: {{ {input} }}) {{ entries {{
         ... on GraphqlChannelMessage {{ {} }}
         ... on GraphqlChannelTimelineActivity {{ __typename id channelId sortKey actorId occurredAt action payload }}
         }} olderCursor newerCursor seq }}", message_selection(),
    )).await["channelTimeline"].clone();
    let rest = reads
        .timeline_entries(access(), query)
        .await
        .expect("REST shared timeline read");
    assert_eq!(data, expected_timeline(&rest));
    let entries = data["entries"].as_array().expect("entries array");
    assert!(
        entries
            .windows(2)
            .all(|pair| pair[0]["sortKey"].as_str() > pair[1]["sortKey"].as_str())
    );
    (data, rest)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_timeline_matches_rest_every_page_and_around_window(pool: PgPool) {
    let reads = fixture(pool).await;
    let harness = harness();
    let context = context(&harness, &reads);
    let (_, full) = timeline(
        &harness,
        &context,
        &reads,
        MessageTimelineQuery {
            limit: Some(100),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(full.entries.len(), 13);
    assert_eq!(
        full.entries
            .iter()
            .filter(|entry| matches!(entry, MessageTimelineEntry::Activity { .. }))
            .count(),
        3
    );
    assert!(
        full.entries
            .iter()
            .any(|entry| matches!(entry, MessageTimelineEntry::Activity { .. }))
    );
    assert_eq!(
        full.entries
            .iter()
            .filter(|entry| matches!(entry, MessageTimelineEntry::Call { .. }))
            .count(),
        3
    );
    assert!(
        !full
            .entries
            .iter()
            .any(|entry| [message_id(4), message_id(5)].contains(&entry.position().1))
    );
    assert!(
        full.entries
            .iter()
            .any(|entry| entry.position().1 == message_id(3))
    );

    for limit in [1u16, 2, 4, 7, 100] {
        let mut cursor = None;
        let mut all = Vec::new();
        loop {
            let (data, page) = timeline(
                &harness,
                &context,
                &reads,
                MessageTimelineQuery {
                    cursor,
                    limit: Some(limit),
                    ..Default::default()
                },
            )
            .await;
            all.extend(data["entries"].as_array().expect("entries").iter().cloned());
            let Some(next) = page.next_cursor else { break };
            cursor = Some(next);
        }
        assert_eq!(
            all,
            full.entries.iter().map(expected_entry).collect::<Vec<_>>()
        );

        // Start strictly before the oldest entry and walk forwards without overlap.
        let oldest = full.entries.last().expect("fixture has history").cursor();
        let mut cursor = Some(MessageCursor {
            created_at: oldest.created_at - Duration::microseconds(1),
            id: oldest.id,
        });
        let mut all = Vec::new();
        loop {
            let (data, page) = timeline(
                &harness,
                &context,
                &reads,
                MessageTimelineQuery {
                    cursor,
                    direction: MessageDirection::Newer,
                    limit: Some(limit),
                    ..Default::default()
                },
            )
            .await;
            let mut entries = data["entries"].as_array().expect("entries").clone();
            entries.reverse();
            all.extend(entries);
            let Some(next) = page.previous_cursor else {
                break;
            };
            cursor = Some(next);
        }
        let mut expected = full.entries.iter().map(expected_entry).collect::<Vec<_>>();
        expected.reverse();
        assert_eq!(all, expected);

        for around in [
            message_id(2),
            message_id(101),
            message_id(1),
            message_id(12),
        ] {
            timeline(
                &harness,
                &context,
                &reads,
                MessageTimelineQuery {
                    around: Some(around),
                    limit: Some(limit),
                    ..Default::default()
                },
            )
            .await;
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_thread_pages_match_rest_and_sort_keys_follow_import_order(pool: PgPool) {
    let reads = fixture(pool).await;
    let harness = harness();
    let context = context(&harness, &reads);
    let rest = reads
        .get_thread(access(), message_id(2))
        .await
        .expect("REST full thread");
    let preview = MessageThreadPreview {
        reply_count: rest.replies.len() as i64,
        latest_reply_at: rest.replies.iter().map(|reply| reply.created_at).max(),
        preview: rest.replies.iter().take(3).cloned().collect(),
    };
    let expected_root = expected_message(&rest.root, Some((&rest.state, &preview)), None);
    let expected: Vec<_> = rest
        .replies
        .iter()
        .map(|reply| expected_message(reply, None, None))
        .collect();
    assert!(
        rest.replies
            .windows(2)
            .all(|pair| message_key(&pair[0]) < message_key(&pair[1]))
    );
    assert_eq!(rest.replies[0].import_order, Some(0));
    assert_eq!(rest.replies.last().expect("replies").import_order, None);

    for limit in [1usize, 2, 4, 7, 100] {
        let mut after = None;
        let mut all = Vec::new();
        loop {
            let input = after
                .as_ref()
                .map(|key| format!(", after: \"{key}\""))
                .unwrap_or_default();
            let data = execute(&harness, &context, &format!(
                "channelThread(input: {{ channelId: \"{CHANNEL_ID}\", rootId: \"{}\", limit: {limit}{input} }})
                 {{ root {{ {} }} replies {{ {} }} olderCursor newerCursor seq }}",
                message_id(2), message_selection(), message_selection(),
            )).await["channelThread"].clone();
            assert_eq!(data["root"], expected_root);
            assert_eq!(data["seq"], "0");
            let page = data["replies"].as_array().expect("thread replies");
            let end = (all.len() + limit).min(expected.len());
            assert_eq!(page, &expected[all.len()..end]);
            assert_eq!(
                data["olderCursor"],
                if all.is_empty() {
                    Value::Null
                } else {
                    page[0]["sortKey"].clone()
                }
            );
            assert_eq!(
                data["newerCursor"],
                if end == expected.len() {
                    Value::Null
                } else {
                    page.last().expect("page reply")["sortKey"].clone()
                }
            );
            all.extend(page.iter().cloned());
            after = data["newerCursor"].as_str().map(str::to_owned);
            if after.is_none() {
                break;
            }
        }
        assert_eq!(all, expected);

        // Read older pages from a position beyond every null-import-order reply.
        let mut before = format!(
            "~-{}",
            timeline_key(DateTime::<Utc>::MAX_UTC, Uuid::from_u128(u128::MAX))
        );
        let mut end = expected.len();
        while end > 0 {
            let data = execute(&harness, &context, &format!(
                "channelThread(input: {{ channelId: \"{CHANNEL_ID}\", rootId: \"{}\", limit: {limit}, before: \"{before}\" }})
                 {{ root {{ {} }} replies {{ {} }} olderCursor newerCursor seq }}",
                message_id(2), message_selection(), message_selection(),
            )).await["channelThread"].clone();
            let start = end.saturating_sub(limit);
            assert_eq!(data["root"], expected_root);
            assert_eq!(data["replies"], json!(&expected[start..end]));
            assert_eq!(
                data["olderCursor"],
                if start == 0 {
                    Value::Null
                } else {
                    expected[start]["sortKey"].clone()
                }
            );
            end = start;
            if end > 0 {
                before = data["olderCursor"]
                    .as_str()
                    .expect("older cursor")
                    .to_owned();
            }
        }

        for target in [0, rest.replies.len() / 2, rest.replies.len() - 1] {
            let around = rest.replies[target].id;
            let data = execute(&harness, &context, &format!(
                "channelThread(input: {{ channelId: \"{CHANNEL_ID}\", rootId: \"{}\", limit: {limit}, around: \"{around}\" }})
                 {{ root {{ {} }} replies {{ {} }} olderCursor newerCursor seq }}",
                message_id(2), message_selection(), message_selection(),
            )).await["channelThread"].clone();
            let mut start = target.saturating_sub((limit - 1) / 2);
            let end = (start + limit).min(expected.len());
            start = end.saturating_sub(limit);
            assert_eq!(data["root"], expected_root);
            assert_eq!(data["replies"], json!(&expected[start..end]));
            assert_eq!(
                data["olderCursor"],
                if start == 0 {
                    Value::Null
                } else {
                    expected[start]["sortKey"].clone()
                }
            );
            assert_eq!(
                data["newerCursor"],
                if end == expected.len() {
                    Value::Null
                } else {
                    expected[end - 1]["sortKey"].clone()
                }
            );
            let domain_page = reads
                .thread_page(
                    access(),
                    message_id(2),
                    MessageThreadQuery {
                        around: Some(around),
                        limit: Some(limit as u16),
                        ..Default::default()
                    },
                )
                .await
                .expect("shared domain around-thread window");
            assert_eq!(
                domain_page
                    .replies
                    .iter()
                    .map(|reply| reply.id)
                    .collect::<Vec<_>>(),
                rest.replies[start..end]
                    .iter()
                    .map(|reply| reply.id)
                    .collect::<Vec<_>>()
            );
        }
    }

    let empty = execute(
        &harness,
        &context,
        &format!(
            "channelThread(input: {{ channelId: \"{CHANNEL_ID}\", rootId: \"{}\" }})
         {{ replies {{ id }} olderCursor newerCursor }}",
            message_id(1),
        ),
    )
    .await;
    assert_eq!(
        empty["channelThread"],
        json!({ "replies": [], "olderCursor": null, "newerCursor": null })
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_single_message_matches_rest_and_respects_channel_access(pool: PgPool) {
    let reads = fixture(pool).await;
    let harness = harness();
    let context = context(&harness, &reads);
    for id in [
        message_id(2),
        message_id(3),
        message_id(5),
        message_id(6),
        message_id(7),
        message_id(8),
        message_id(9),
        message_id(10),
        message_id(101),
        message_id(105),
    ] {
        let rest = reads.get(access(), id).await.expect("REST item read");
        let data = execute(
            &harness,
            &context,
            &format!(
                "channelMessage(channelId: \"{CHANNEL_ID}\", messageId: \"{id}\") {{ {} }}",
                message_selection(),
            ),
        )
        .await;
        let thread = if rest.thread_id.is_none() {
            Some(
                reads
                    .get_thread(access(), id)
                    .await
                    .expect("REST thread metadata"),
            )
        } else {
            None
        };
        let preview = thread.as_ref().map(|thread| MessageThreadPreview {
            reply_count: thread.replies.len() as i64,
            latest_reply_at: thread.replies.iter().map(|reply| reply.created_at).max(),
            preview: thread.replies.iter().take(3).cloned().collect(),
        });
        let status = if rest.kind == MessageKind::CallRoot {
            match id {
                id if id == message_id(8) => Some(CallEntryStatus::Ended {
                    ended_at: DateTime::parse_from_rfc3339("2026-10-06T12:03:00.123456Z")
                        .expect("end time")
                        .with_timezone(&Utc),
                    duration_ms: 180_000,
                }),
                id if id == message_id(9) => Some(CallEntryStatus::Live),
                _ => Some(CallEntryStatus::RecordDeleted),
            }
        } else {
            None
        };
        assert_eq!(
            data["channelMessage"],
            expected_message(
                &rest,
                thread
                    .as_ref()
                    .zip(preview.as_ref())
                    .map(|(thread, preview)| (&thread.state, preview)),
                status
            )
        );
    }
    for id in [message_id(4), message_id(204), message_id(9999)] {
        assert!(reads.get(access(), id).await.is_err());
        let data = execute(
            &harness,
            &context,
            &format!("channelMessage(channelId: \"{CHANNEL_ID}\", messageId: \"{id}\") {{ id }}",),
        )
        .await;
        assert!(data["channelMessage"].is_null());
    }
    harness
        .state
        .entity_access
        .viewable_channels
        .lock()
        .expect("channel access lock")
        .insert(OTHER_CHANNEL_ID);
    let isolated = execute(
        &harness,
        &context,
        &format!(
            "channelMessage(channelId: \"{OTHER_CHANNEL_ID}\", messageId: \"{}\") {{ id }}",
            message_id(2),
        ),
    )
    .await;
    assert!(
        isolated["channelMessage"].is_null(),
        "a grant on another channel cannot reveal the message"
    );
    harness
        .state
        .entity_access
        .viewable_channels
        .lock()
        .expect("channel access lock")
        .remove(&OTHER_CHANNEL_ID);
    for field in [
        format!(
            "channelMessage(channelId: \"{OTHER_CHANNEL_ID}\", messageId: \"{}\") {{ id }}",
            message_id(2)
        ),
        format!("channelTimeline(input: {{ channelId: \"{OTHER_CHANNEL_ID}\" }}) {{ seq }}"),
        format!(
            "channelThread(input: {{ channelId: \"{OTHER_CHANNEL_ID}\", rootId: \"{}\" }}) {{ seq }}",
            message_id(2)
        ),
        format!(
            "channelChanges(input: {{ channelId: \"{OTHER_CHANNEL_ID}\", after: \"0\" }}) {{ seq }}"
        ),
    ] {
        let denied = harness
            .schema
            .execute(
                harness
                    .request(&format!("{{ user {{ {field} }} }}",), authenticated_parts())
                    .data(context.clone()),
            )
            .await;
        assert_eq!(denied.errors.len(), 1, "{field}");
        assert_eq!(
            denied.errors[0]
                .extensions
                .as_ref()
                .expect("access error code")
                .get("code"),
            Some(&async_graphql::Value::from("FORBIDDEN"))
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_reads_reject_ambiguous_or_invalid_positions(pool: PgPool) {
    let reads = fixture(pool).await;
    let harness = harness();
    let context = context(&harness, &reads);
    let key = timeline_key(
        DateTime::parse_from_rfc3339("2026-10-06T12:00:00.123456Z")
            .expect("timestamp")
            .with_timezone(&Utc),
        message_id(1),
    );
    for input in [
        format!("before: \"{key}\", after: \"{key}\""),
        format!("before: \"{key}\", around: \"{}\"", message_id(1)),
        "before: \"invalid\"".to_owned(),
    ] {
        for field in [
            format!(
                "channelTimeline(input: {{ channelId: \"{CHANNEL_ID}\", {input} }}) {{ entries {{ __typename }} }}"
            ),
            format!(
                "channelThread(input: {{ channelId: \"{CHANNEL_ID}\", rootId: \"{}\", {input} }}) {{ replies {{ id }} }}",
                message_id(2)
            ),
        ] {
            let response = harness
                .schema
                .execute(
                    harness
                        .request(&format!("{{ user {{ {field} }} }}"), authenticated_parts())
                        .data(context.clone()),
                )
                .await;
            assert_eq!(response.errors.len(), 1, "{field}");
        }
    }
    for root in [message_id(4), message_id(101)] {
        let response = harness.schema.execute(harness.request(&format!(
            "{{ user {{ channelThread(input: {{ channelId: \"{CHANNEL_ID}\", rootId: \"{root}\" }}) {{ replies {{ id }} }} }} }}",
        ), authenticated_parts()).data(context.clone())).await;
        assert_eq!(response.errors.len(), 1, "inaccessible root {root}");
    }
}

#[tokio::test]
async fn channel_reads_require_the_channel_context() {
    let harness = harness();
    let response = harness.schema.execute(harness.request(&format!(
        "{{ user {{ channelTimeline(input: {{ channelId: \"{CHANNEL_ID}\" }}) {{ seq }} }} }}",
    ), authenticated_parts())).await;
    assert_eq!(response.errors.len(), 1);
}
