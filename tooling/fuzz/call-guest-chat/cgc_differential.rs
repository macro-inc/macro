use entity_access::domain::models::{AccessLevel, Entity, EntityAccessReceipt, EntityPermission};
use messages::domain::{
    models::{MessageParent, PostMessage, SimpleMention},
    ports::{
        MessageError, MessageEvent, MessageEventPublisher, MessagePatch, MessageTimelineQuery,
    },
    service::{MessageService, MessageView, MessageWrite},
};
use messages::outbound::pg_message_repo::PgMessageRepository;
use serde_json::{Value, json};
use sqlx::{PgPool, Row, types::Json};
use std::{
    fs::File,
    io::{BufWriter, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Clone, Default)]
struct Events(Arc<Mutex<Vec<MessageEvent>>>);

impl MessageEventPublisher for Events {
    async fn publish(&self, event: MessageEvent) -> Result<(), rootcause::Report> {
        self.0.lock().expect("events mutex").push(event);
        Ok(())
    }
}

#[derive(Clone)]
struct Parent {
    kind: String,
    id: String,
    parent: MessageParent,
    messages: Vec<(Uuid, Option<Uuid>, String, bool)>,
}

fn next(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

fn receipt<P: entity_access::domain::models::RequiredPermission>(
    parent: &Parent,
    user: &str,
    access_level: AccessLevel,
) -> EntityAccessReceipt<P> {
    EntityAccessReceipt::try_new_authenticated_user(
        user.to_owned().try_into().expect("account id"),
        Entity {
            entity_id: parent.id.clone(),
            entity_type: parent.parent.access_entity_type(),
        },
        EntityPermission::AccessLevel { access_level },
    )
    .expect("access receipt")
}

fn result<T: serde::Serialize>(value: Result<T, MessageError>) -> Value {
    match value {
        Ok(value) => json!({"ok": value}),
        Err(MessageError::NotFound) => json!({"error": "not_found"}),
        Err(MessageError::Forbidden) => json!({"error": "forbidden"}),
        Err(MessageError::Conflict) => json!({"error": "conflict"}),
        Err(MessageError::Invalid(reason)) => json!({"error": "invalid", "reason": reason}),
        Err(MessageError::Repository(_)) => json!({"error": "repository"}),
    }
}

fn write(file: &mut impl Write, key: String, value: Value) {
    writeln!(file, "{}", json!({"key": key, "value": value})).expect("probe output");
}

async fn parents(pool: &PgPool) -> Vec<Parent> {
    let rows = sqlx::query(
        "SELECT parent_entity_type, parent_entity_id, id, thread_id, sender_id, kind::text AS kind \
         FROM comms_messages ORDER BY parent_entity_type, parent_entity_id, created_at, id",
    )
    .fetch_all(pool)
    .await
    .expect("corpus messages");
    let mut parents: Vec<Parent> = Vec::new();
    for row in rows {
        let kind: String = row.get("parent_entity_type");
        let id: String = row.get("parent_entity_id");
        let message_id: Uuid = row.get("id");
        let thread_id: Option<Uuid> = row.get("thread_id");
        let sender: String = row.get("sender_id");
        let message_kind: String = row.get("kind");
        if parents
            .last()
            .is_none_or(|parent| parent.kind != kind || parent.id != id)
        {
            let parent = MessageParent::parse(&kind, &id).expect("stored parent");
            parents.push(Parent {
                kind: kind.clone(),
                id: id.clone(),
                parent,
                messages: Vec::new(),
            });
        }
        parents.last_mut().expect("new parent").messages.push((
            message_id,
            thread_id,
            sender,
            message_kind == "call_root",
        ));
    }
    let rows = sqlx::query("SELECT id::text AS id FROM \"Document\" ORDER BY id LIMIT 4")
        .fetch_all(pool)
        .await
        .expect("documents");
    for row in rows {
        let id: String = row.get("id");
        if !parents
            .iter()
            .any(|parent| parent.kind == "document" && parent.id == id)
        {
            parents.push(Parent {
                kind: "document".into(),
                id: id.clone(),
                parent: MessageParent::parse("document", &id).expect("document id"),
                messages: Vec::new(),
            });
        }
    }
    let rows = sqlx::query("SELECT id::text AS id FROM comms_channels ORDER BY id")
        .fetch_all(pool)
        .await
        .expect("channels");
    for row in rows {
        let id: String = row.get("id");
        if !parents
            .iter()
            .any(|parent| parent.kind == "channel" && parent.id == id)
        {
            parents.push(Parent {
                kind: "channel".into(),
                id: id.clone(),
                parent: MessageParent::parse("channel", &id).expect("channel id"),
                messages: Vec::new(),
            });
        }
    }
    parents.sort_by(|a, b| (&a.kind, &a.id).cmp(&(&b.kind, &b.id)));
    parents
}

async fn viewer_ids(pool: &PgPool) -> Vec<String> {
    let rows = sqlx::query("SELECT id FROM \"User\" WHERE id LIKE 'macro|%' ORDER BY id LIMIT 3")
        .fetch_all(pool)
        .await
        .expect("viewers");
    rows.into_iter().map(|row| row.get("id")).collect()
}

async fn read_cases(
    service: &MessageService<PgMessageRepository, Events>,
    parents: &[Parent],
    viewers: &[String],
    file: &mut impl Write,
) -> usize {
    let mut cases = 0;
    for parent in parents {
        for viewer in viewers {
            let key = format!("{}:{}:{viewer}", parent.kind, parent.id);
            let query = MessageTimelineQuery {
                limit: Some(100),
                ..Default::default()
            };
            write(
                file,
                format!("{key}:timeline"),
                result(
                    service
                        .timeline(
                            receipt::<MessageView>(parent, viewer, AccessLevel::View),
                            query.clone(),
                        )
                        .await,
                ),
            );
            write(
                file,
                format!("{key}:timeline_entries"),
                result(
                    service
                        .timeline_entries(
                            receipt::<MessageView>(parent, viewer, AccessLevel::View),
                            query,
                        )
                        .await,
                ),
            );
            cases += 2;
            for (id, thread_id, _, _) in &parent.messages {
                write(
                    file,
                    format!("{key}:get:{id}"),
                    result(
                        service
                            .get(
                                receipt::<MessageView>(parent, viewer, AccessLevel::View),
                                *id,
                            )
                            .await,
                    ),
                );
                cases += 1;
                write(
                    file,
                    format!("{key}:preceding:{id}"),
                    result(
                        service
                            .preceding(
                                receipt::<MessageView>(parent, viewer, AccessLevel::View),
                                *id,
                                10,
                            )
                            .await,
                    ),
                );
                cases += 1;
                if thread_id.is_none() {
                    write(
                        file,
                        format!("{key}:thread:{id}"),
                        result(
                            service
                                .get_thread(
                                    receipt::<MessageView>(parent, viewer, AccessLevel::View),
                                    *id,
                                )
                                .await,
                        ),
                    );
                    cases += 1;
                }
            }
        }
    }
    cases
}

async fn write_cases(
    service: &MessageService<PgMessageRepository, Events>,
    events: &Events,
    parents: &mut [Parent],
    viewers: &[String],
    file: &mut impl Write,
    event_file: &mut impl Write,
    operations: usize,
    seed: u64,
) {
    let mut state = seed.max(1);
    let now_ms = std::env::var("CGC_UUID_TIME_MS")
        .expect("fixed time")
        .parse::<u128>()
        .expect("millis");
    for parent in parents.iter() {
        for (root_id, _, _, is_call_root) in &parent.messages {
            if !is_call_root {
                continue;
            }
            let viewer = &viewers[0];
            let access = || receipt::<MessageWrite>(parent, viewer, AccessLevel::Owner);
            for operation in ["patch", "delete", "react"] {
                let key = format!("call_root:{root_id}:{operation}");
                let response = match operation {
                    "patch" => result(
                        service
                            .patch(
                                access(),
                                *root_id,
                                MessagePatch {
                                    content: Some("blocked".into()),
                                    ..Default::default()
                                },
                            )
                            .await,
                    ),
                    "delete" => result(service.delete(access(), *root_id, None).await),
                    _ => result(
                        service
                            .react(access(), *root_id, "👍".into(), true, None)
                            .await,
                    ),
                };
                write(file, key.clone(), response);
                let published = std::mem::take(&mut *events.0.lock().expect("events mutex"));
                write(event_file, key, json!(published));
            }
        }
    }
    for index in 0..operations {
        let parent_index = index % parents.len();
        let parent = &mut parents[parent_index];
        let viewer = &viewers[(next(&mut state) as usize) % viewers.len()];
        let kind = next(&mut state) % 11;
        let target = parent
            .messages
            .get((next(&mut state) as usize) % parent.messages.len().max(1))
            .cloned();
        let op = match kind {
            0 | 1 | 2 => "post",
            3 => "reply",
            4 => "quote_reply",
            5 => "patch",
            6 => "delete",
            7 => "react_add",
            8 => "react_remove",
            _ => "react_invalid",
        };
        let key = format!("{index}:{op}:{}:{}", parent.kind, parent.id);
        let operation_id =
            Uuid::from_u128((now_ms << 80) | (7u128 << 76) | (2u128 << 62) | (index as u128 + 1));
        let access = || receipt::<MessageWrite>(parent, viewer, AccessLevel::Owner);
        let mut content = format!("fuzz {seed} {index}");
        if index % 37 == 0 {
            content.clear();
        }
        let response = match op {
            "post" | "reply" | "quote_reply" => {
                let root = target
                    .as_ref()
                    .map(|(id, thread_id, _, _)| thread_id.unwrap_or(*id));
                if op == "quote_reply" {
                    if let Some((target_id, _, sender, _)) = &target {
                        content = format!(
                            "<m-reply-target>{{\"targetMessageId\":\"{target_id}\",\"senderId\":\"{sender}\",\"parent\":{{\"type\":\"{}\",\"id\":\"{}\"}}}}</m-reply-target> {content}",
                            parent.kind, parent.id
                        );
                    }
                }
                let thread_id = if op == "post" {
                    None
                } else {
                    root.or(Some(Uuid::nil()))
                };
                let value = service
                    .post(
                        access(),
                        PostMessage {
                            id: Some(operation_id),
                            content,
                            thread_id,
                            anchor: None,
                            mentions: if index % 61 == 0 {
                                vec![SimpleMention {
                                    entity_type: "user".into(),
                                    entity_id: "participant:00000000-0000-0000-0000-000000000001"
                                        .into(),
                                }]
                            } else {
                                Vec::new()
                            },
                            attachments: Vec::new(),
                            nonce: Some(format!("fuzz-{index}")),
                            attribution: Default::default(),
                            notification_policy: Default::default(),
                        },
                    )
                    .await;
                if let Ok(message) = &value {
                    parent
                        .messages
                        .push((message.id, message.thread_id, viewer.clone(), false));
                }
                result(value)
            }
            "patch" => result(
                service
                    .patch(
                        access(),
                        target.map_or(Uuid::nil(), |v| v.0),
                        MessagePatch {
                            content: Some(content),
                            nonce: Some(format!("fuzz-{index}")),
                            ..Default::default()
                        },
                    )
                    .await,
            ),
            "delete" => result(
                service
                    .delete(
                        access(),
                        target.map_or(Uuid::nil(), |v| v.0),
                        Some(format!("fuzz-{index}")),
                    )
                    .await,
            ),
            "react_add" | "react_remove" | "react_invalid" => result(
                service
                    .react(
                        access(),
                        target.map_or(Uuid::nil(), |v| v.0),
                        if op == "react_invalid" {
                            "\u{0}"
                        } else {
                            "👍"
                        }
                        .into(),
                        op == "react_add",
                        Some(format!("fuzz-{index}")),
                    )
                    .await,
            ),
            _ => unreachable!(),
        };
        write(file, key.clone(), response);
        let published = std::mem::take(&mut *events.0.lock().expect("events mutex"));
        write(event_file, key, json!(published));
    }
}

async fn rows(pool: &PgPool, file: &mut impl Write) {
    for (table, order) in [
        ("comms_messages", "id"),
        ("comms_message_threads", "root_id"),
        ("comms_reactions", "message_id, user_id, emoji"),
    ] {
        let query = format!("SELECT to_jsonb(t) AS data FROM {table} t ORDER BY {order}");
        for (index, row) in sqlx::query(&query)
            .fetch_all(pool)
            .await
            .expect("snapshot rows")
            .into_iter()
            .enumerate()
        {
            let data: Json<Value> = row.get("data");
            write(file, format!("{table}:{index}"), data.0);
        }
    }
}

#[tokio::test]
#[ignore]
async fn differential_messages() {
    let output = PathBuf::from(std::env::var("CGC_OUTPUT_DIR").expect("output dir"));
    let pool = PgPool::connect(&std::env::var("CGC_DATABASE_URL").expect("database URL"))
        .await
        .expect("scratch database");
    let mut parents = parents(&pool).await;
    let viewers = viewer_ids(&pool).await;
    assert!(!parents.is_empty(), "corpus has no message parents");
    assert!(!viewers.is_empty(), "corpus has no account viewers");
    let reaction_count: i64 = sqlx::query_scalar("SELECT count(*) FROM comms_reactions")
        .fetch_one(&pool)
        .await
        .expect("reaction count");
    let thread_count: i64 = sqlx::query_scalar("SELECT count(*) FROM comms_message_threads")
        .fetch_one(&pool)
        .await
        .expect("thread count");
    let corpus = json!({
        "parents": parents.len(), "viewers": viewers.len(),
        "messages": parents.iter().map(|parent| parent.messages.len()).sum::<usize>(),
        "reactions": reaction_count, "threads": thread_count,
        "parent_kinds": parents.iter().fold(std::collections::BTreeMap::<String, usize>::new(), |mut counts, parent| { *counts.entry(parent.kind.clone()).or_default() += 1; counts }),
    });
    std::fs::write(output.join("corpus.json"), corpus.to_string()).expect("corpus count");
    let events = Events::default();
    let service = MessageService::new(PgMessageRepository::new(pool.clone()), events.clone())
        .with_activity(activity::outbound::pg_activity_repo::PgActivityRepo::new(
            pool.clone(),
        ));
    let mut reads = BufWriter::new(File::create(output.join("reads.jsonl")).expect("reads"));
    read_cases(&service, &parents, &viewers, &mut reads).await;
    let mut writes = BufWriter::new(File::create(output.join("writes.jsonl")).expect("writes"));
    let mut published = BufWriter::new(File::create(output.join("events.jsonl")).expect("events"));
    let operations = std::env::var("CGC_OPERATIONS")
        .expect("operations")
        .parse::<usize>()
        .expect("number of operations");
    let seed = std::env::var("CGC_SEED")
        .expect("seed")
        .parse::<u64>()
        .expect("numeric seed");
    write_cases(
        &service,
        &events,
        &mut parents,
        &viewers,
        &mut writes,
        &mut published,
        operations,
        seed,
    )
    .await;
    let mut snapshot = BufWriter::new(File::create(output.join("rows.jsonl")).expect("rows"));
    rows(&pool, &mut snapshot).await;
}
