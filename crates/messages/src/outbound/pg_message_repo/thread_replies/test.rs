use chrono::Duration;
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    ParticipantRole,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;
use crate::domain::{
    historical::{HistoricalBatch, HistoricalMessage},
    models::{MessageKind, PostMessage},
    ports::{
        CreateMessage, HistoricalMessageRepository, MessageRepository, NoMessageEventPublisher,
    },
    service::{MessageService, MessageView},
};

const USER: &str = "macro|thread-replies@example.com";

type Service = MessageService<PgMessageRepository, NoMessageEventPublisher>;

async fn channel(pool: &PgPool) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'Replies', 'private', $2)",
        id,
        USER,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

fn post(parent: &MessageParent, thread_id: Option<Uuid>, content: &str) -> CreateMessage {
    CreateMessage {
        kind: MessageKind::Message,
        guest_name: None,
        canonical_root_id: None,
        parent: parent.clone(),
        actor: USER.to_owned().try_into().unwrap(),
        triggered_via: None,
        triggered_by: None,
        input: PostMessage {
            id: None,
            attribution: Default::default(),
            notification_policy: Default::default(),
            content: content.into(),
            thread_id,
            anchor: None,
            mentions: vec![],
            attachments: vec![],
            nonce: None,
        },
    }
}

fn imported(
    thread_id: Option<Uuid>,
    import_order: i64,
    created_at: DateTime<Utc>,
) -> HistoricalMessage {
    HistoricalMessage {
        id: macro_uuid::generate_uuid_v7(),
        thread_id,
        sender: USER.try_into().unwrap(),
        imported_author: None,
        content: format!("imported {import_order}"),
        created_at,
        updated_at: created_at,
        edited_at: None,
        import_metadata: serde_json::json!({"slack_import_job": Uuid::nil(), "body_version": 1}),
        import_order,
        reactions: vec![],
        mentions: vec![],
    }
}

/// Imported timestamps carry whole seconds here; the importer allows at most
/// microseconds.
fn import_time() -> DateTime<Utc> {
    DateTime::from_timestamp(Utc::now().timestamp(), 0).unwrap() - Duration::days(400)
}

fn viewer(channel_id: Uuid) -> EntityAccessReceipt<MessageView> {
    EntityAccessReceipt::try_new_authenticated_user(
        USER.to_owned().try_into().unwrap(),
        Entity {
            entity_type: EntityType::Channel,
            entity_id: channel_id.to_string(),
        },
        EntityPermission::ChannelRole {
            role: ParticipantRole::Member,
        },
    )
    .unwrap()
}

/// A channel thread of 53 live replies. 20 are imported: pairs share an
/// import order and fours share a timestamp. 33 were posted: threes share a
/// timestamp, a day before the imported history, so only the import order
/// puts them last. Five more replies of both kinds are deleted.
async fn long_thread(pool: &PgPool) -> (Service, EntityAccessReceipt<MessageView>, Uuid) {
    let channel_id = channel(pool).await;
    let parent = MessageParent::Channel(channel_id);
    let repo = PgMessageRepository::new(pool.clone());
    let at = import_time();
    let root = imported(None, 0, at);
    let mut batch = vec![root.clone()];
    for index in 0..22 {
        batch.push(imported(
            Some(root.id),
            1 + index / 2,
            at + Duration::seconds(index / 4),
        ));
    }
    repo.insert_historical(&HistoricalBatch {
        channel_id,
        messages: batch.clone(),
    })
    .await
    .unwrap();
    let mut posted = Vec::new();
    for index in 0..36 {
        let reply = repo
            .create(post(&parent, Some(root.id), &format!("posted {index}")))
            .await
            .unwrap();
        posted.push(reply.id);
    }
    for (index, id) in (0..).zip(&posted) {
        let created_at = at - Duration::days(1) + Duration::seconds(index / 3);
        sqlx::query!(
            "UPDATE comms_messages SET created_at = $2 WHERE id = $1",
            id,
            created_at,
        )
        .execute(pool)
        .await
        .unwrap();
    }
    for id in [batch[4].id, batch[19].id, posted[0], posted[17], posted[35]] {
        repo.delete(&parent, id).await.unwrap();
    }
    let service = MessageService::new(repo, NoMessageEventPublisher);
    (service, viewer(channel_id), root.id)
}

/// Every page from `query` on, following its cursors in its direction, in
/// the order they were read.
async fn follow(
    service: &Service,
    reader: &EntityAccessReceipt<MessageView>,
    root: Uuid,
    mut query: ThreadRepliesQuery,
) -> Vec<Vec<Message>> {
    let mut pages = Vec::new();
    loop {
        let page = service
            .thread_replies(reader.clone(), root, query.clone())
            .await
            .unwrap();
        assert!(page.replies.len() <= usize::from(query.page_size()));
        assert_eq!(
            page.older_cursor.map(|cursor| cursor.id),
            page.older_cursor
                .and(page.replies.first().map(|reply| reply.id)),
        );
        assert_eq!(
            page.newer_cursor.map(|cursor| cursor.id),
            page.newer_cursor
                .and(page.replies.last().map(|reply| reply.id)),
        );
        // A page read from a cursor has the cursor's reply behind it.
        let (ahead, behind) = match query.direction {
            MessageDirection::Newer => (page.newer_cursor, page.older_cursor),
            MessageDirection::Older => (page.older_cursor, page.newer_cursor),
        };
        assert_eq!(behind.is_some(), query.cursor.is_some());
        pages.push(page.replies);
        let Some(ahead) = ahead else {
            return pages;
        };
        query.cursor = Some(ahead);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pages_in_either_direction_rebuild_the_whole_thread(pool: PgPool) {
    let (service, reader, root) = long_thread(&pool).await;
    let thread = service.get_thread(reader.clone(), root).await.unwrap();
    assert_eq!(thread.replies.len(), 53);
    let expected = serde_json::to_value(&thread.replies).unwrap();

    let forward = follow(
        &service,
        &reader,
        root,
        ThreadRepliesQuery {
            direction: MessageDirection::Newer,
            limit: Some(7),
            ..Default::default()
        },
    )
    .await;
    let sizes: Vec<_> = forward.iter().map(Vec::len).collect();
    assert_eq!(sizes, [7, 7, 7, 7, 7, 7, 7, 4]);
    let forward: Vec<_> = forward.into_iter().flatten().collect();
    assert_eq!(serde_json::to_value(&forward).unwrap(), expected);

    let backward = follow(
        &service,
        &reader,
        root,
        ThreadRepliesQuery {
            direction: MessageDirection::Older,
            limit: Some(7),
            ..Default::default()
        },
    )
    .await;
    let sizes: Vec<_> = backward.iter().map(Vec::len).collect();
    assert_eq!(sizes, [7, 7, 7, 7, 7, 7, 7, 4]);
    let backward: Vec<_> = backward.into_iter().rev().flatten().collect();
    assert_eq!(serde_json::to_value(&backward).unwrap(), expected);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_window_around_a_reply_continues_both_ways(pool: PgPool) {
    let (service, reader, root) = long_thread(&pool).await;
    let thread = service.get_thread(reader.clone(), root).await.unwrap();
    let expected = serde_json::to_value(&thread.replies).unwrap();
    let ids: Vec<_> = thread.replies.iter().map(|reply| reply.id).collect();

    // The first and last replies, the last imported and first posted ones,
    // and one among the posted ones; with the window's first reply.
    for (target, start) in [(0, 0), (19, 16), (20, 17), (35, 32), (52, 46)] {
        let window = service
            .thread_replies(
                reader.clone(),
                root,
                ThreadRepliesQuery {
                    around: Some(ids[target]),
                    limit: Some(7),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let read: Vec<_> = window.replies.iter().map(|reply| reply.id).collect();
        assert_eq!(read, ids[start..start + 7]);
        assert_eq!(
            window.older_cursor.map(|cursor| cursor.id),
            (start > 0).then_some(ids[start]),
        );
        assert_eq!(
            window.newer_cursor.map(|cursor| cursor.id),
            (start + 7 < ids.len()).then_some(ids[start + 6]),
        );

        let mut whole = Vec::new();
        if let Some(cursor) = window.older_cursor {
            let older = ThreadRepliesQuery {
                cursor: Some(cursor),
                direction: MessageDirection::Older,
                limit: Some(7),
                around: None,
            };
            let pages = follow(&service, &reader, root, older).await;
            whole.extend(pages.into_iter().rev().flatten());
        }
        whole.extend(window.replies);
        if let Some(cursor) = window.newer_cursor {
            let newer = ThreadRepliesQuery {
                cursor: Some(cursor),
                direction: MessageDirection::Newer,
                limit: Some(7),
                around: None,
            };
            let pages = follow(&service, &reader, root, newer).await;
            whole.extend(pages.into_iter().flatten());
        }
        assert_eq!(serde_json::to_value(&whole).unwrap(), expected);
    }

    // A window of one is the reply alone, with more on both sides.
    let window = service
        .thread_replies(
            reader.clone(),
            root,
            ThreadRepliesQuery {
                around: Some(ids[20]),
                limit: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(window.replies.len(), 1);
    assert_eq!(window.older_cursor.map(|cursor| cursor.id), Some(ids[20]));
    assert_eq!(window.newer_cursor.map(|cursor| cursor.id), Some(ids[20]));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleted_replies_and_threads_read_as_get_thread_reads_them(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let parent = MessageParent::Channel(channel_id);
    let repo = PgMessageRepository::new(pool.clone());
    let service = MessageService::new(repo.clone(), NoMessageEventPublisher);
    let reader = viewer(channel_id);
    let root = repo.create(post(&parent, None, "root")).await.unwrap();
    let mut replies = Vec::new();
    for index in 0..6 {
        let reply = repo
            .create(post(&parent, Some(root.id), &format!("reply {index}")))
            .await
            .unwrap();
        replies.push(reply);
    }
    repo.delete(&parent, replies[1].id).await.unwrap();
    repo.delete(&parent, replies[4].id).await.unwrap();
    // A deleted root keeps its live replies, as a tombstone.
    repo.delete(&parent, root.id).await.unwrap();

    let thread = service.get_thread(reader.clone(), root.id).await.unwrap();
    assert_eq!(thread.replies.len(), 4);
    let pages = follow(
        &service,
        &reader,
        root.id,
        ThreadRepliesQuery {
            direction: MessageDirection::Newer,
            limit: Some(2),
            ..Default::default()
        },
    )
    .await;
    let read: Vec<_> = pages.into_iter().flatten().collect();
    assert_eq!(
        serde_json::to_value(&read).unwrap(),
        serde_json::to_value(&thread.replies).unwrap()
    );
    let page = service
        .thread_replies(reader.clone(), root.id, ThreadRepliesQuery::default())
        .await
        .unwrap();
    assert!(page.root.deleted_at.is_some());
    assert_eq!(
        serde_json::to_value(&page.root).unwrap(),
        serde_json::to_value(&thread.root).unwrap()
    );

    // A cursor on a reply deleted since it was read still reads on.
    let page = service
        .thread_replies(
            reader.clone(),
            root.id,
            ThreadRepliesQuery {
                cursor: Some(ReplyCursor {
                    import_order: None,
                    created_at: replies[1].created_at,
                    id: replies[1].id,
                }),
                direction: MessageDirection::Newer,
                limit: Some(2),
                around: None,
            },
        )
        .await
        .unwrap();
    let read: Vec<_> = page.replies.iter().map(|reply| reply.id).collect();
    assert_eq!(read, [replies[2].id, replies[3].id]);
    assert_eq!(
        page.older_cursor.map(|cursor| cursor.id),
        Some(replies[2].id)
    );
    assert_eq!(
        page.newer_cursor.map(|cursor| cursor.id),
        Some(replies[3].id)
    );

    // Only a live reply of this thread can center a window.
    let other = repo.create(post(&parent, None, "other")).await.unwrap();
    let other_reply = repo
        .create(post(&parent, Some(other.id), "other reply"))
        .await
        .unwrap();
    for id in [replies[1].id, root.id, other_reply.id, Uuid::now_v7()] {
        let result = service
            .thread_replies(
                reader.clone(),
                root.id,
                ThreadRepliesQuery {
                    around: Some(id),
                    ..Default::default()
                },
            )
            .await;
        assert!(matches!(result, Err(MessageError::NotFound)), "{id}");
    }

    repo.delete_thread(&parent, root.id).await.unwrap();
    assert!(matches!(
        service.get_thread(reader.clone(), root.id).await,
        Err(MessageError::NotFound)
    ));
    assert!(matches!(
        service
            .thread_replies(reader.clone(), root.id, ThreadRepliesQuery::default())
            .await,
        Err(MessageError::NotFound)
    ));
    // Another channel's reader cannot read the thread either.
    let elsewhere = viewer(channel(&pool).await);
    assert!(matches!(
        service
            .thread_replies(elsewhere, other.id, ThreadRepliesQuery::default())
            .await,
        Err(MessageError::NotFound)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_centered_window_takes_no_cursor_and_limits_are_clamped(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let service = MessageService::new(repo.clone(), NoMessageEventPublisher);
    let reader = viewer(channel_id);
    let at = import_time();
    let root = imported(None, 0, at);
    let mut batch = vec![root.clone()];
    for index in 1..=101 {
        batch.push(imported(
            Some(root.id),
            index,
            at + Duration::seconds(index),
        ));
    }
    repo.insert_historical(&HistoricalBatch {
        channel_id,
        messages: batch.clone(),
    })
    .await
    .unwrap();

    let both = ThreadRepliesQuery {
        cursor: Some(ReplyCursor {
            import_order: Some(1),
            created_at: batch[1].created_at,
            id: batch[1].id,
        }),
        around: Some(batch[1].id),
        ..Default::default()
    };
    assert!(matches!(
        service.thread_replies(reader.clone(), root.id, both).await,
        Err(MessageError::Invalid(_))
    ));

    for (limit, size) in [(Some(0), 1), (None, 50), (Some(100), 100), (Some(500), 100)] {
        let page = service
            .thread_replies(
                reader.clone(),
                root.id,
                ThreadRepliesQuery {
                    limit,
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(page.replies.len(), size);
        assert_eq!(page.replies.last().unwrap().id, batch[101].id);
        let first = &batch[102 - size];
        assert_eq!(page.replies[0].id, first.id);
        assert_eq!(
            page.older_cursor,
            Some(ReplyCursor {
                import_order: Some(first.import_order),
                created_at: first.created_at,
                id: first.id,
            })
        );
        assert_eq!(page.newer_cursor, None);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn document_discussions_page_like_channel_threads(pool: PgPool) {
    let user_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, 'thread-replies', 'thread-replies@example.com', 'thread-replies')"#,
        user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, 'thread-replies@example.com', $2)"#,
        USER,
        user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType") VALUES ('replies-doc', 'replies-doc', $1, 'md')"#,
        USER
    )
    .execute(&pool)
    .await
    .unwrap();
    let parent = MessageParent::parse("document", "replies-doc").unwrap();
    let repo = PgMessageRepository::new(pool.clone());
    let service = MessageService::new(repo.clone(), NoMessageEventPublisher);
    let reader = EntityAccessReceipt::try_new(
        EntityAccessAuth::Authenticated(USER.to_owned().try_into().unwrap()),
        Entity {
            entity_type: EntityType::Document,
            entity_id: "replies-doc".into(),
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap();
    let root = repo.create(post(&parent, None, "root")).await.unwrap();
    for index in 0..5 {
        repo.create(post(&parent, Some(root.id), &format!("reply {index}")))
            .await
            .unwrap();
    }

    let thread = service.get_thread(reader.clone(), root.id).await.unwrap();
    assert_eq!(thread.replies.len(), 5);
    let pages = follow(
        &service,
        &reader,
        root.id,
        ThreadRepliesQuery {
            direction: MessageDirection::Older,
            limit: Some(2),
            ..Default::default()
        },
    )
    .await;
    let read: Vec<_> = pages.into_iter().rev().flatten().collect();
    assert_eq!(
        serde_json::to_value(&read).unwrap(),
        serde_json::to_value(&thread.replies).unwrap()
    );
}
