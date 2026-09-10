use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const USER: &str = "macro|message-test@example.com";

async fn setup(pool: &PgPool) {
    let user_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, 'message-test', 'message-test@example.com', 'message-test')"#,
        user_id
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, 'message-test@example.com', $2)"#, USER, user_id)
        .execute(pool).await.unwrap();
    for id in ["message-doc-a", "message-doc-b"] {
        sqlx::query!(
            r#"INSERT INTO "Document" (id, name, owner, "fileType") VALUES ($1, $1, $2, 'md')"#,
            id,
            USER
        )
        .execute(pool)
        .await
        .unwrap();
    }
}

fn command(document: &str, root: Option<Uuid>, content: &str) -> CreateMessage {
    CreateMessage {
        parent: MessageParent::parse("document", document).unwrap(),
        actor: USER.to_owned().try_into().unwrap(),
        triggered_by: None,
        input: PostMessage {
            attribution: Default::default(),
            notification_policy: Default::default(),
            content: content.into(),
            thread_id: root,
            anchor: None,
            mentions: vec![],
            attachments: vec![],
            nonce: None,
        },
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn shared_reads_preserve_system_and_deleted_bot_profiles(pool: PgPool) {
    setup(&pool).await;
    let deleted_bot = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO bots (id, kind, owner_user_id, name, handle, avatar_url, deleted_at) \
         VALUES ($1, 'owned', $2, 'Historical Agent', 'historical-agent', 'https://example.com/agent.png', now())",
    )
    .bind(deleted_bot)
    .bind(USER)
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgMessageRepository::new(pool);
    for (bot_id, name, avatar_url) in [
        (
            bot_id::MACRO_AI_BOT_ID,
            bot_id::system_bot(bot_id::MACRO_AI_BOT_ID).unwrap().name,
            None,
        ),
        (
            bot_id::BotId::new_from_uuid(deleted_bot),
            "Historical Agent",
            Some("https://example.com/agent.png"),
        ),
    ] {
        let mut input = command("message-doc-a", None, "Agent answer");
        input.actor = channel_sender::ChannelSender::new_from_bot(bot_id);
        input.triggered_by = Some(USER.to_owned());
        let message = repo.create(input).await.unwrap();
        let read = repo
            .get(&message.parent, message.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            read.bot_profile,
            Some(BotSenderProfile {
                name: name.to_owned(),
                avatar_url: avatar_url.map(str::to_owned),
            })
        );
        let listed = repo.hydrate_roots(&[message.id]).await.unwrap();
        assert_eq!(listed[0].message.bot_profile, read.bot_profile);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn thread_identity_tombstones_and_parent_isolation(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let parent = MessageParent::parse("document", "message-doc-a").unwrap();
    let root = repo
        .create(command("message-doc-a", None, "root"))
        .await
        .unwrap();
    let reply = repo
        .create(command("message-doc-a", Some(root.id), "reply"))
        .await
        .unwrap();
    assert_eq!(reply.thread_id, Some(root.id));
    assert!(
        repo.create(command("message-doc-b", Some(root.id), "cross-parent"))
            .await
            .is_err()
    );
    assert!(
        repo.create(command("message-doc-a", Some(reply.id), "nested"))
            .await
            .is_err()
    );
    let deleted = repo.delete(&parent, root.id).await.unwrap();
    assert!(deleted.deleted_at.is_some());
    let page = repo
        .timeline(
            &parent,
            MessageTimelineQuery {
                cursor: None,
                limit: Some(10),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert!(page.items[0].message.content.is_empty());
    assert_eq!(page.items[0].thread.preview[0].content, "reply");
    repo.create(command(
        "message-doc-a",
        Some(root.id),
        "reply to tombstone",
    ))
    .await
    .unwrap();
    repo.delete_thread(&parent, root.id).await.unwrap();
    assert!(
        repo.timeline(
            &parent,
            MessageTimelineQuery {
                cursor: None,
                limit: Some(10),
                ..Default::default()
            }
        )
        .await
        .unwrap()
        .items
        .is_empty()
    );
    assert!(
        repo.create(command(
            "message-doc-a",
            Some(root.id),
            "reply to deleted thread"
        ))
        .await
        .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleted_markdown_threads_keep_paged_cleanup_identity(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let mark_id = Uuid::from_u128(102);
    let mut create = command("message-doc-a", None, "removed discussion");
    create.input.anchor = Some(NewThreadAnchor::Markdown { mark_id });
    let deleted = repo.create(create).await.unwrap();
    let state = repo
        .delete_thread(&deleted.parent, deleted.id)
        .await
        .unwrap();
    assert!(state.deleted_at.is_some());
    assert!(matches!(state.anchor, Some(ThreadAnchor::Markdown { mark_id: id }) if id == mark_id));
    let live = repo
        .create(command("message-doc-a", None, "live discussion"))
        .await
        .unwrap();

    // A new reader must recover deletion without a live event or old root cache.
    let repo = PgMessageRepository::new(pool);
    let normal = repo
        .timeline(&deleted.parent, MessageTimelineQuery::default())
        .await
        .unwrap();
    assert_eq!(normal.items.len(), 1);
    assert_eq!(normal.items[0].message.id, live.id);
    let first = repo
        .timeline(
            &deleted.parent,
            MessageTimelineQuery {
                include_deleted_threads: true,
                limit: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(first.items[0].message.id, live.id);
    let older = repo
        .timeline(
            &deleted.parent,
            MessageTimelineQuery {
                include_deleted_threads: true,
                cursor: first.next_cursor,
                limit: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(older.items.len(), 1);
    assert_eq!(older.items[0].message.id, deleted.id);
    assert!(older.items[0].message.content.is_empty());
    assert!(older.items[0].state.deleted_at.is_some());
    assert!(
        matches!(older.items[0].state.anchor, Some(ThreadAnchor::Markdown { mark_id: id }) if id == mark_id)
    );
    assert!(older.next_cursor.is_none());
    let other_parent = MessageParent::parse("document", "message-doc-b").unwrap();
    assert!(
        repo.timeline(
            &other_parent,
            MessageTimelineQuery {
                include_deleted_threads: true,
                ..Default::default()
            }
        )
        .await
        .unwrap()
        .items
        .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reactions_attachments_and_resolution_use_shared_message_data(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool);
    let mut create = command("message-doc-a", None, "message");
    create.input.anchor = Some(NewThreadAnchor::Markdown {
        mark_id: Uuid::from_u128(100),
    });
    create.input.attachments.push(NewAttachment {
        entity_type: "document".into(),
        entity_id: "message-doc-b".into(),
        width: None,
        height: None,
    });
    let root = repo.create(create).await.unwrap();
    assert_eq!(root.attachments.len(), 1);
    repo.react(&root.parent, root.id, USER, "👍", true)
        .await
        .unwrap();
    let reacted = repo
        .react(&root.parent, root.id, USER, "👍", true)
        .await
        .unwrap();
    assert_eq!(reacted.reactions.len(), 1);
    assert_eq!(reacted.reactions[0].users, vec![USER]);
    assert!(
        repo.patch_thread(
            &root.parent,
            root.id,
            ThreadPatch {
                resolved: Some(true),
                ..Default::default()
            }
        )
        .await
        .unwrap()
        .resolved
    );
    let edit = EditMessage {
        notification_policy: Default::default(),
        content: "edited".into(),
        mentions: vec![],
        attachments: Some(vec![]),
        nonce: None,
    };
    let edited = repo.edit(&root.parent, root.id, edit).await.unwrap();
    assert_eq!(edited.content, "edited");
    assert!(edited.attachments.is_empty());
    assert!(edited.edited_at.is_some());
    let state = repo.thread(&root.parent, root.id).await.unwrap().unwrap();
    assert!(state.anchor.is_some());
    assert!(state.resolved);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn detaching_a_mark_retains_the_complete_thread_and_makes_it_unanchored(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let mut create = command("message-doc-a", None, "anchored root");
    create.input.anchor = Some(NewThreadAnchor::Markdown {
        mark_id: Uuid::from_u128(101),
    });
    let root = repo.create(create).await.unwrap();
    let reply = repo
        .create(command("message-doc-a", Some(root.id), "retained reply"))
        .await
        .unwrap();
    let state = repo
        .patch_thread(
            &root.parent,
            root.id,
            ThreadPatch {
                detach_anchor: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(state.anchor.is_none());
    assert!(state.deleted_at.is_none());
    let reloaded = PgMessageRepository::new(pool);
    let page = reloaded
        .timeline(
            &root.parent,
            MessageTimelineQuery {
                anchored: Some(false),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].message.id, root.id);
    assert_eq!(page.items[0].message.content, "anchored root");
    assert_eq!(page.items[0].thread.reply_count, 1);
    assert_eq!(page.items[0].thread.preview[0].id, reply.id);
    assert!(
        reloaded
            .patch_thread(
                &root.parent,
                root.id,
                ThreadPatch {
                    detach_anchor: true,
                    ..Default::default()
                }
            )
            .await
            .unwrap()
            .anchor
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn parent_deletion_cascades_and_cursor_does_not_repeat_roots(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let root = repo
        .create(command("message-doc-a", None, "first"))
        .await
        .unwrap();
    repo.create(command("message-doc-a", None, "second"))
        .await
        .unwrap();
    let first = repo
        .timeline(
            &root.parent,
            MessageTimelineQuery {
                cursor: None,
                limit: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let second = repo
        .timeline(
            &root.parent,
            MessageTimelineQuery {
                cursor: first.next_cursor,
                limit: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(first.items.len(), 1);
    assert_eq!(second.items.len(), 1);
    assert_ne!(first.items[0].message.id, second.items[0].message.id);
    assert!(second.next_cursor.is_none());
    sqlx::query!(r#"DELETE FROM "Document" WHERE id = 'message-doc-a'"#)
        .execute(&pool)
        .await
        .unwrap();
    assert!(repo.get(&root.parent, root.id).await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pdf_root_tombstone_keeps_anchor_and_thread_deletion_removes_placeable(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let anchor_id = macro_uuid::generate_uuid_v7();
    let mut create = command("message-doc-a", None, "PDF discussion");
    create.input.anchor = Some(NewThreadAnchor::PdfPlaceable {
        anchor_id,
        page: 1,
        x_pct: 0.2,
        y_pct: 0.3,
        width_pct: 0.05,
        height_pct: 0.05,
    });
    let root = repo.create(create).await.unwrap();
    let saved = sqlx::query!(r#"SELECT "threadId" AS thread_id, "xPct" AS x FROM "PdfPlaceableCommentAnchor" WHERE uuid = $1"#, anchor_id)
        .fetch_one(&pool).await.unwrap();
    assert_eq!(saved.thread_id, root.id);
    assert_eq!(saved.x, 0.2);
    repo.delete(&root.parent, root.id).await.unwrap();
    assert_eq!(
        repo.thread(&root.parent, root.id)
            .await
            .unwrap()
            .unwrap()
            .anchor,
        Some(ThreadAnchor::PdfPlaceable { anchor_id })
    );
    repo.delete_thread(&root.parent, root.id).await.unwrap();
    assert!(!sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM "PdfPlaceableCommentAnchor" WHERE uuid = $1) AS "exists!""#, anchor_id)
        .fetch_one(&pool).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn highlight_attachment_is_scoped_and_explicit_thread_deletion_preserves_highlight(
    pool: PgPool,
) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let anchor_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(r#"INSERT INTO "PdfHighlightAnchor"
        (uuid, "documentId", owner, page, red, green, blue, alpha, type, text, "pageViewportWidth", "pageViewportHeight")
        VALUES ($1, 'message-doc-a', $2, 1, 255, 255, 0, 0.5, 1, 'selected text', 600, 800)"#, anchor_id, USER)
        .execute(&pool).await.unwrap();
    let mut create = command("message-doc-b", None, "wrong parent");
    create.input.anchor = Some(NewThreadAnchor::PdfHighlight { anchor_id });
    assert!(repo.create(create.clone()).await.is_err());
    assert!(
        repo.timeline(
            &create.parent,
            MessageTimelineQuery {
                cursor: None,
                limit: Some(10),
                ..Default::default()
            }
        )
        .await
        .unwrap()
        .items
        .is_empty()
    );
    create.parent = MessageParent::parse("document", "message-doc-a").unwrap();
    let root = repo.create(create).await.unwrap();
    repo.delete_thread(&root.parent, root.id).await.unwrap();
    let remaining = sqlx::query!(
        r#"SELECT "threadId" AS thread_id, text FROM "PdfHighlightAnchor" WHERE uuid = $1"#,
        anchor_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(remaining.thread_id.is_none());
    assert_eq!(remaining.text, "selected text");
}

#[cfg(feature = "delivery")]
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn discussion_delivery_context_reads_document_assignees_and_thread_authors(pool: PgPool) {
    use crate::{
        domain::delivery::DiscussionContextReader,
        outbound::pg_discussion_context::PgDiscussionContext,
    };
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let root = repo
        .create(command("message-doc-a", None, "task discussion"))
        .await
        .unwrap();
    sqlx::query!(
        "INSERT INTO document_sub_type(document_id, sub_type) VALUES ('message-doc-a', 'task')"
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO entity_properties(id, entity_id, entity_type, property_definition_id, values)
        VALUES ($1, 'message-doc-a', 'DOCUMENT', $2, $3)"#,
        macro_uuid::generate_uuid_v7(),
        system_properties::SystemPropertyKey::Assignees.uuid(),
        serde_json::json!({
            "type": "EntityReference", "value": [{"entity_type": "USER", "entity_id": USER}]
        })
    )
    .execute(&pool)
    .await
    .unwrap();
    let context = PgDiscussionContext(pool)
        .context(&root.parent, root.id)
        .await
        .unwrap();
    assert!(context.is_task);
    assert_eq!(context.owner, USER);
    assert_eq!(context.assignees, vec![USER]);
    assert_eq!(context.participants, vec![USER]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_mark_identifies_one_live_discussion_per_document(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool);
    let marked = |document: &str| {
        let mut request = command(document, None, "Anchored");
        request.input.anchor = Some(NewThreadAnchor::Markdown {
            mark_id: Uuid::from_u128(77),
        });
        request
    };
    let first = repo.create(marked("message-doc-a")).await.unwrap();
    assert!(repo.create(marked("message-doc-a")).await.is_err());
    // Copying text to another document retains mark IDs without sharing its thread.
    let other = repo.create(marked("message-doc-b")).await.unwrap();
    assert_ne!(other.id, first.id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn agent_context_stays_in_the_document_thread_and_omits_tombstones(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool);
    let root = repo
        .create(command("message-doc-a", None, "this thread"))
        .await
        .unwrap();
    let deleted = repo
        .create(command("message-doc-a", Some(root.id), "removed"))
        .await
        .unwrap();
    repo.delete(&root.parent, deleted.id).await.unwrap();
    repo.create(command("message-doc-a", None, "unrelated discussion"))
        .await
        .unwrap();
    repo.create(command("message-doc-b", None, "other document"))
        .await
        .unwrap();
    let reply = repo
        .create(command("message-doc-a", Some(root.id), "@agent explain"))
        .await
        .unwrap();
    repo.create(command("message-doc-a", Some(root.id), "later response"))
        .await
        .unwrap();
    let history = repo.preceding(&root.parent, reply.id, 10).await.unwrap();
    assert_eq!(
        history
            .iter()
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>(),
        ["this thread"]
    );
    assert!(
        repo.preceding(
            &MessageParent::parse("document", "message-doc-b").unwrap(),
            reply.id,
            10
        )
        .await
        .unwrap()
        .is_empty()
    );
    repo.delete_thread(&root.parent, root.id).await.unwrap();
    assert!(
        repo.preceding(&root.parent, reply.id, 10)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_references_deduplicate_roots_and_exclude_removed_mentions_and_threads(
    pool: PgPool,
) {
    setup(&pool).await;
    let channel = macro_uuid::generate_uuid_v7();
    sqlx::query!("INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'Source', 'private', $2)", channel, USER).execute(&pool).await.unwrap();
    let repo = PgMessageRepository::new(pool.clone());
    let parent = MessageParent::Channel(channel);
    let create = |root, doc: &str| {
        let mut cmd = command("message-doc-a", root, "source message");
        cmd.parent = parent.clone();
        cmd.input.mentions = vec![SimpleMention {
            entity_type: "document".into(),
            entity_id: doc.into(),
        }];
        cmd
    };
    let root = repo.create(create(None, "message-doc-a")).await.unwrap();
    let reply = repo
        .create(create(Some(root.id), "message-doc-a"))
        .await
        .unwrap();
    let other = repo.create(create(None, "message-doc-b")).await.unwrap();
    let candidates = repo
        .referenced_threads("message-doc-a", None, 10)
        .await
        .unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].root_id, root.id);
    repo.delete(&parent, root.id).await.unwrap();
    assert_eq!(
        repo.referenced_threads("message-doc-a", None, 10)
            .await
            .unwrap()
            .len(),
        1,
        "a live mentioning reply retains the source thread"
    );
    repo.edit(
        &parent,
        reply.id,
        EditMessage {
            notification_policy: Default::default(),
            content: "reference removed".into(),
            mentions: vec![],
            attachments: None,
            nonce: None,
        },
    )
    .await
    .unwrap();
    assert!(
        repo.referenced_threads("message-doc-a", None, 10)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        repo.referenced_threads("message-doc-b", None, 10)
            .await
            .unwrap()[0]
            .root_id,
        other.id
    );
    repo.delete_thread(&parent, other.id).await.unwrap();
    assert!(
        repo.referenced_threads("message-doc-b", None, 10)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replacement_attachments_preserve_retained_ids_and_remove_only_missing_items(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool);
    let attachment = NewAttachment {
        entity_type: "document".into(),
        entity_id: "message-doc-b".into(),
        width: Some(100),
        height: Some(50),
    };
    let mut create = command("message-doc-a", None, "with attachment");
    create.input.attachments.push(attachment.clone());
    let message = repo.create(create).await.unwrap();
    let edited = repo
        .edit(
            &message.parent,
            message.id,
            EditMessage {
                notification_policy: Default::default(),
                content: "same attachment".into(),
                mentions: vec![],
                attachments: Some(vec![attachment]),
                nonce: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(edited.attachments[0].id, message.attachments[0].id);
    assert_eq!(edited.attachments[0].width, Some(100));
    let removed = repo
        .edit(
            &message.parent,
            message.id,
            EditMessage {
                notification_policy: Default::default(),
                content: "removed attachment".into(),
                mentions: vec![],
                attachments: Some(vec![]),
                nonce: None,
            },
        )
        .await
        .unwrap();
    assert!(removed.attachments.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn both_parents_use_bounded_previews_and_bidirectional_windows(pool: PgPool) {
    setup(&pool).await;
    let channel = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels(id, channel_type, owner_id) VALUES ($1, 'private', $2)",
        channel,
        USER
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgMessageRepository::new(pool.clone());
    for parent in [
        MessageParent::Channel(channel),
        MessageParent::parse("document", "message-doc-a").unwrap(),
    ] {
        let mut roots = Vec::new();
        for index in 0..7 {
            let mut input = command("message-doc-a", None, &format!("root {index}"));
            input.parent = parent.clone();
            roots.push(repo.create(input).await.unwrap());
        }
        let root = roots[3].id;
        for index in 0..12 {
            let mut input = command("message-doc-a", Some(root), &format!("reply {index}"));
            input.parent = parent.clone();
            repo.create(input).await.unwrap();
        }
        let latest = repo
            .timeline(
                &parent,
                MessageTimelineQuery {
                    limit: Some(3),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            latest
                .items
                .iter()
                .map(|m| m.message.id)
                .collect::<Vec<_>>(),
            vec![roots[6].id, roots[5].id, roots[4].id]
        );
        assert!(latest.previous_cursor.is_none());
        let older = repo
            .timeline(
                &parent,
                MessageTimelineQuery {
                    cursor: latest.next_cursor,
                    limit: Some(3),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(older.items[0].message.id, root);
        assert_eq!(older.items[0].thread.reply_count, 12);
        assert_eq!(older.items[0].thread.preview.len(), 3);
        assert_eq!(older.items[0].thread.preview[0].content, "reply 0");
        let newer = repo
            .timeline(
                &parent,
                MessageTimelineQuery {
                    cursor: older.previous_cursor,
                    direction: MessageDirection::Newer,
                    limit: Some(3),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            newer.items.iter().map(|m| m.message.id).collect::<Vec<_>>(),
            latest
                .items
                .iter()
                .map(|m| m.message.id)
                .collect::<Vec<_>>()
        );
        let reply = older.items[0].thread.preview[0].id;
        let around = repo
            .timeline(
                &parent,
                MessageTimelineQuery {
                    around: Some(reply),
                    limit: Some(3),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            around
                .items
                .iter()
                .map(|m| m.message.id)
                .collect::<Vec<_>>(),
            vec![roots[4].id, root, roots[2].id]
        );
        assert!(around.next_cursor.is_some() && around.previous_cursor.is_some());
        assert!(around.items.iter().all(|m| m.message.parent == parent));
        assert!(matches!(
            repo.timeline(
                &MessageParent::parse("document", "message-doc-b").unwrap(),
                MessageTimelineQuery {
                    around: Some(reply),
                    ..Default::default()
                },
            )
            .await,
            Err(MessageError::NotFound)
        ));
        // Activity windows include a root when a reply, rather than the root, falls in the window.
        let active = repo
            .timeline(
                &parent,
                MessageTimelineQuery {
                    activity_after: Some(older.items[0].thread.preview[0].created_at),
                    ids: vec![root, roots[0].id],
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            active
                .items
                .iter()
                .map(|item| item.message.id)
                .collect::<Vec<_>>(),
            vec![root]
        );
        let future = repo
            .timeline(
                &parent,
                MessageTimelineQuery {
                    activity_after: Some(chrono::Utc::now() + chrono::Duration::seconds(1)),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert!(future.items.is_empty());
        // Around an edge, backfill from the other side instead of returning a short page.
        for (anchor, expected) in [
            (roots[0].id, vec![roots[2].id, roots[1].id, roots[0].id]),
            (roots[6].id, vec![roots[6].id, roots[5].id, roots[4].id]),
        ] {
            let edge = repo
                .timeline(
                    &parent,
                    MessageTimelineQuery {
                        around: Some(anchor),
                        limit: Some(3),
                        ..Default::default()
                    },
                )
                .await
                .unwrap();
            assert_eq!(
                edge.items
                    .iter()
                    .map(|item| item.message.id)
                    .collect::<Vec<_>>(),
                expected
            );
        }
        repo.delete(&parent, roots[0].id).await.unwrap();
        let empty_root = repo
            .timeline(
                &parent,
                MessageTimelineQuery {
                    ids: vec![roots[0].id],
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            empty_root.items.is_empty(),
            matches!(parent, MessageParent::Channel(_))
        );
        let centered_empty_root = repo
            .timeline(
                &parent,
                MessageTimelineQuery {
                    around: Some(roots[0].id),
                    limit: Some(1),
                    ..Default::default()
                },
            )
            .await;
        if matches!(parent, MessageParent::Channel(_)) {
            assert!(matches!(centered_empty_root, Err(MessageError::NotFound)));
        } else {
            let page = centered_empty_root.unwrap();
            assert_eq!(page.items[0].message.id, roots[0].id);
            assert!(page.items[0].message.deleted_at.is_some());
        }
        repo.delete(&parent, root).await.unwrap();
        let page = repo
            .timeline(
                &parent,
                MessageTimelineQuery {
                    ids: vec![root],
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert!(page.items[0].message.deleted_at.is_some());
        assert_eq!(page.items[0].thread.reply_count, 12);
        for target in [root, reply] {
            let centered_deleted_root = repo
                .timeline(
                    &parent,
                    MessageTimelineQuery {
                        around: Some(target),
                        limit: Some(1),
                        ..Default::default()
                    },
                )
                .await
                .unwrap();
            assert_eq!(centered_deleted_root.items[0].message.id, root);
            assert!(centered_deleted_root.items[0].message.deleted_at.is_some());
            assert_eq!(centered_deleted_root.items[0].thread.reply_count, 12);
        }
        repo.delete_thread(&parent, root).await.unwrap();
        for target in [root, reply] {
            assert!(matches!(
                repo.timeline(
                    &parent,
                    MessageTimelineQuery {
                        around: Some(target),
                        ..Default::default()
                    },
                )
                .await,
                Err(MessageError::NotFound)
            ));
        }
        assert!(
            repo.timeline(
                &parent,
                MessageTimelineQuery {
                    ids: vec![root],
                    ..Default::default()
                }
            )
            .await
            .unwrap()
            .items
            .is_empty()
        );
    }
}
