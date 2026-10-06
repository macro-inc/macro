use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const USER: &str = "macro|message-test@example.com";

mod initiative;
mod schema_drop;

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
        canonical_root_id: None,
        parent: MessageParent::parse("document", document).unwrap(),
        actor: USER.to_owned().try_into().unwrap(),
        triggered_by: None,
        input: PostMessage {
            id: None,
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
    sqlx::query!(
        "INSERT INTO bots (id, kind, owner_user_id, name, handle, avatar_url, deleted_at) \
         VALUES ($1, 'owned', $2, 'Historical Agent', 'historical-agent', 'https://example.com/agent.png', now())",
        deleted_bot,
        USER,
    )
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
async fn a_deleted_discussion_reads_back_as_a_root_tombstone_without_replies(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let parent = MessageParent::parse("document", "message-doc-a").unwrap();
    let root = repo
        .create(command("message-doc-a", None, "root"))
        .await
        .unwrap();
    repo.create(command("message-doc-a", Some(root.id), "reply"))
        .await
        .unwrap();
    repo.delete_thread(&parent, root.id).await.unwrap();
    // Deleting a root reads the message back after the teardown to answer the
    // caller; that read is the tombstone, not the live root it started from.
    let tombstone = repo.get(&parent, root.id).await.unwrap().unwrap();
    assert!(tombstone.deleted_at.is_some());
    assert!(tombstone.content.is_empty());
    assert!(repo.replies(&parent, root.id).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleted_markdown_threads_keep_paged_cleanup_identity(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let mark_id = Uuid::from_u128(102);
    let mut create = command("message-doc-a", None, "removed discussion");
    create.input.anchor = Some(NewThreadAnchor::Markdown {
        mark_id,
        marked_text: None,
    });
    let deleted = repo.create(create).await.unwrap();
    let state = repo
        .delete_thread(&deleted.parent, deleted.id)
        .await
        .unwrap();
    assert!(state.deleted_at.is_some());
    assert!(
        matches!(state.anchor, Some(ThreadAnchor::Markdown { mark_id: id, .. }) if id == mark_id)
    );
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
        matches!(older.items[0].state.anchor, Some(ThreadAnchor::Markdown { mark_id: id, .. }) if id == mark_id)
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
async fn a_markdown_anchor_stores_the_marked_text_beside_its_mark(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool);
    let mark_id = Uuid::from_u128(150);
    let mut create = command("message-doc-a", None, "what does this mean?");
    create.input.anchor = Some(NewThreadAnchor::Markdown {
        mark_id,
        marked_text: Some("  the marked phrase  ".to_owned()),
    });
    let root = repo.create(create).await.unwrap();
    let state = repo.thread(&root.parent, root.id).await.unwrap().unwrap();
    assert_eq!(
        state.anchor,
        Some(ThreadAnchor::Markdown {
            mark_id,
            marked_text: Some("the marked phrase".to_owned()),
        })
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reactions_attachments_and_resolution_use_shared_message_data(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool);
    let mut create = command("message-doc-a", None, "message");
    create.input.anchor = Some(NewThreadAnchor::Markdown {
        mark_id: Uuid::from_u128(100),
        marked_text: None,
    });
    create.input.attachments.push(NewAttachment {
        entity_type: "document".into(),
        entity_id: "message-doc-b".into(),
        width: None,
        height: None,
    });
    let root = repo.create(create).await.unwrap();
    assert_eq!(root.attachments.len(), 1);
    let added = repo
        .react(&root.parent, root.id, USER, "👍", true)
        .await
        .unwrap();
    assert!(added.changed);
    let reacted = repo
        .react(&root.parent, root.id, USER, "👍", true)
        .await
        .unwrap();
    assert!(!reacted.changed);
    assert_eq!(reacted.message.reactions.len(), 1);
    assert_eq!(reacted.message.reactions[0].users, vec![USER]);
    let removed = repo
        .react(&root.parent, root.id, USER, "👍", false)
        .await
        .unwrap();
    assert!(removed.changed);
    assert!(removed.message.reactions.is_empty());
    let removed_again = repo
        .react(&root.parent, root.id, USER, "👍", false)
        .await
        .unwrap();
    assert!(!removed_again.changed);
    assert!(removed_again.message.reactions.is_empty());
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
        marked_text: None,
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
async fn soft_deleted_parents_disappear_and_cursor_does_not_repeat_roots(pool: PgPool) {
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
    assert!(repo.parent_exists(&root.parent).await.unwrap());
    sqlx::query!(r#"UPDATE "Document" SET "deletedAt" = now() WHERE id = 'message-doc-a'"#)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!repo.parent_exists(&root.parent).await.unwrap());
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
    let saved = sqlx::query!(
        r#"SELECT root_id, "xPct" AS x FROM "PdfPlaceableCommentAnchor" WHERE uuid = $1"#,
        anchor_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(saved.root_id, root.id);
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
    let root = repo.create(create.clone()).await.unwrap();
    // The root identity alone prevents a second discussion from stealing a highlight.
    assert!(repo.create(create.clone()).await.is_err());
    repo.delete_thread(&root.parent, root.id).await.unwrap();
    let remaining = sqlx::query!(
        r#"SELECT root_id, text FROM "PdfHighlightAnchor" WHERE uuid = $1"#,
        anchor_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(remaining.root_id.is_none());
    assert_eq!(remaining.text, "selected text");
    // Deleting a discussion releases its highlight for a new discussion.
    let replacement = repo.create(create).await.unwrap();
    assert_ne!(replacement.id, root.id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn placeable_anchor_creation_is_atomic_with_its_root(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let anchor_id = macro_uuid::generate_uuid_v7();
    let placeable = |content: &str| {
        let mut create = command("message-doc-a", None, content);
        create.input.anchor = Some(NewThreadAnchor::PdfPlaceable {
            anchor_id,
            page: 1,
            x_pct: 0.2,
            y_pct: 0.3,
            width_pct: 0.05,
            height_pct: 0.05,
        });
        create
    };
    let root = repo.create(placeable("first")).await.unwrap();
    let anchored = sqlx::query!(
        r#"SELECT root_id FROM "PdfPlaceableCommentAnchor" WHERE uuid = $1"#,
        anchor_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(anchored.root_id, root.id);

    // Reusing the annotation id fails inside the transaction, so neither the
    // second root nor its thread row survive.
    assert!(repo.create(placeable("second")).await.is_err());
    let roots = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM comms_messages
           WHERE parent_entity_type = 'document' AND parent_entity_id = 'message-doc-a'"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(roots, 1);
    let threads = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM comms_message_threads
           WHERE parent_entity_type = 'document' AND parent_entity_id = 'message-doc-a'"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(threads, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn roots_get_thread_rows_without_the_bookkeeping_trigger(pool: PgPool) {
    setup(&pool).await;
    sqlx::query!("DROP TRIGGER trg_initialize_comms_message_thread ON comms_messages")
        .execute(&pool)
        .await
        .unwrap();
    let repo = PgMessageRepository::new(pool.clone());
    let mut create = command("message-doc-a", None, "root without trigger");
    create.input.anchor = Some(NewThreadAnchor::Markdown {
        mark_id: Uuid::from_u128(202),
        marked_text: None,
    });
    let root = repo.create(create).await.unwrap();
    let state = repo.thread(&root.parent, root.id).await.unwrap().unwrap();
    assert_eq!(state.user_id, USER);
    assert!(
        matches!(state.anchor, Some(ThreadAnchor::Markdown { mark_id, .. }) if mark_id == Uuid::from_u128(202))
    );
    let reply = repo
        .create(command("message-doc-a", Some(root.id), "reply"))
        .await
        .unwrap();
    assert_eq!(reply.thread_id, Some(root.id));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_and_document_attachments_use_message_parent_identity(pool: PgPool) {
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
    let attachment = NewAttachment {
        entity_type: "document".into(),
        entity_id: "message-doc-b".into(),
        width: None,
        height: None,
    };
    let mut channel_post = command("message-doc-a", None, "channel");
    channel_post.parent = MessageParent::Channel(channel);
    channel_post.input.attachments.push(attachment.clone());
    let channel_message = repo.create(channel_post).await.unwrap();
    let mut document_post = command("message-doc-a", None, "document");
    document_post.input.attachments.push(attachment);
    let document_message = repo.create(document_post).await.unwrap();
    let columns = sqlx::query!(
        r#"SELECT m.id, m.parent_entity_type, m.parent_entity_id, a.entity_id
           FROM comms_messages m JOIN comms_attachments a ON a.message_id = m.id
           WHERE m.id = ANY($1) ORDER BY m.created_at"#,
        &[channel_message.id, document_message.id]
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(columns[0].parent_entity_type, "channel");
    assert_eq!(columns[0].parent_entity_id, channel.to_string());
    assert_eq!(columns[1].parent_entity_type, "document");
    assert_eq!(columns[1].parent_entity_id, "message-doc-a");
    assert!(columns.iter().all(|row| row.entity_id == "message-doc-b"));
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
    assert_eq!(context.owner.as_deref(), Some(USER));
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
            marked_text: None,
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
async fn attachments_read_back_in_the_order_they_were_sent(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool);
    let sent = [
        "doc-7", "doc-2", "doc-9", "doc-0", "doc-5", "doc-3", "doc-8", "doc-1", "doc-6", "doc-4",
    ];
    let mut create = command("message-doc-a", None, "ten attachments");
    create.input.attachments = sent
        .iter()
        .map(|entity_id| NewAttachment {
            entity_type: "document".into(),
            entity_id: (*entity_id).into(),
            width: None,
            height: None,
        })
        .collect();
    let message = repo.create(create).await.unwrap();
    let read = repo
        .get(&message.parent, message.id)
        .await
        .unwrap()
        .unwrap();
    let order: Vec<_> = read
        .attachments
        .iter()
        .map(|attachment| attachment.entity_id.as_str())
        .collect();
    assert_eq!(order, sent);
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_ids_resolve_through_the_import_mapping_tables(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let parent = MessageParent::parse("document", "message-doc-a").unwrap();
    let root = repo
        .create(command("message-doc-a", None, "imported root"))
        .await
        .unwrap();
    let reply = repo
        .create(command("message-doc-a", Some(root.id), "imported reply"))
        .await
        .unwrap();
    sqlx::query!(
        "INSERT INTO migrated_comment_thread_id (thread_id, root_id, document_id) VALUES (1, $1, 'message-doc-a')",
        root.id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO migrated_comment_id (comment_id, message_id, document_id)
         VALUES (10, $1, 'message-doc-a'), (11, $2, 'message-doc-a')",
        root.id,
        reply.id
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        repo.resolve_legacy(&parent, 11, false).await.unwrap(),
        Some(reply.id)
    );
    assert_eq!(
        repo.resolve_legacy(&parent, 10, false).await.unwrap(),
        Some(root.id)
    );
    assert_eq!(
        repo.resolve_legacy(&parent, 1, true).await.unwrap(),
        Some(root.id)
    );
    // A comment id is not a thread id, and a mapping only resolves under its own document.
    assert_eq!(repo.resolve_legacy(&parent, 11, true).await.unwrap(), None);
    let other = MessageParent::parse("document", "message-doc-b").unwrap();
    assert_eq!(repo.resolve_legacy(&other, 11, false).await.unwrap(), None);
    let channel = MessageParent::parse("channel", &Uuid::from_u128(7).to_string()).unwrap();
    assert_eq!(
        repo.resolve_legacy(&channel, 11, false).await.unwrap(),
        None
    );

    // Mappings cannot point at messages that were never written.
    let dangling = sqlx::query!(
        "INSERT INTO migrated_comment_id (comment_id, message_id, document_id) VALUES (12, $1, 'message-doc-a')",
        macro_uuid::generate_uuid_v7()
    )
    .execute(&pool)
    .await
    .unwrap_err();
    assert_eq!(
        dangling.as_database_error().unwrap().code().as_deref(),
        Some("23503")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn client_supplied_ids_are_kept_and_never_reused(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool);
    let id = macro_uuid::generate_uuid_v7();
    let mut first = command("message-doc-a", None, "first");
    first.input.id = Some(id);
    assert_eq!(repo.create(first).await.unwrap().id, id);

    // A reused id conflicts even on another parent, and never overwrites.
    let mut second = command("message-doc-b", None, "second");
    second.input.id = Some(id);
    assert!(matches!(
        repo.create(second).await,
        Err(MessageError::Conflict)
    ));
    let parent = MessageParent::parse("document", "message-doc-a").unwrap();
    assert_eq!(
        repo.get(&parent, id).await.unwrap().unwrap().content,
        "first"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn highlight_threads_read_the_text_the_highlight_covers(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let parent = MessageParent::parse("document", "message-doc-a").unwrap();
    let highlight = |text: &'static str| {
        let pool = pool.clone();
        async move {
            let anchor_id = macro_uuid::generate_uuid_v7();
            sqlx::query!(r#"INSERT INTO "PdfHighlightAnchor"
                (uuid, "documentId", owner, page, red, green, blue, alpha, type, text, "pageViewportWidth", "pageViewportHeight")
                VALUES ($1, 'message-doc-a', $2, 1, 255, 255, 0, 0.5, 1, $3, 600, 800)"#, anchor_id, USER, text)
                .execute(&pool).await.unwrap();
            anchor_id
        }
    };
    let thread_on = |anchor_id: Uuid, content: &str| {
        let mut create = command("message-doc-a", None, content);
        create.input.anchor = Some(NewThreadAnchor::PdfHighlight { anchor_id });
        create
    };
    let covered = highlight("  the highlighted words \n").await;
    let blank = highlight("   ").await;
    let root = repo.create(thread_on(covered, "on words")).await.unwrap();
    let blank_root = repo.create(thread_on(blank, "on nothing")).await.unwrap();
    let anchor = |anchor_id, text: Option<&str>| {
        Some(ThreadAnchor::PdfHighlight {
            anchor_id,
            marked_text: text.map(str::to_owned),
        })
    };

    let stored = sqlx::query_scalar!(
        r#"SELECT anchor AS "anchor!" FROM comms_message_threads WHERE root_id = $1"#,
        root.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        stored,
        serde_json::json!({ "type": "pdf_highlight", "anchor_id": covered })
    );
    assert_eq!(
        repo.thread(&parent, root.id).await.unwrap().unwrap().anchor,
        anchor(covered, Some("the highlighted words"))
    );
    assert_eq!(
        repo.thread(&parent, blank_root.id)
            .await
            .unwrap()
            .unwrap()
            .anchor,
        anchor(blank, None)
    );

    sqlx::query!(
        r#"UPDATE "PdfHighlightAnchor" SET text = 'edited words' WHERE uuid = $1"#,
        covered
    )
    .execute(&pool)
    .await
    .unwrap();
    let timeline = repo
        .timeline(
            &parent,
            MessageTimelineQuery {
                limit: Some(10),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let mut anchors: Vec<_> = timeline
        .items
        .into_iter()
        .map(|item| (item.message.id, item.state.anchor))
        .collect();
    anchors.sort_by_key(|(id, _)| *id);
    assert_eq!(
        anchors,
        vec![
            (root.id, anchor(covered, Some("edited words"))),
            (blank_root.id, anchor(blank, None)),
        ]
    );
    let patched = repo
        .patch_thread(
            &parent,
            root.id,
            ThreadPatch {
                resolved: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(patched.anchor, anchor(covered, Some("edited words")));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn parent_of_names_only_a_live_message_parent(pool: PgPool) {
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

    assert_eq!(
        repo.parent_of(reply.id).await.unwrap(),
        Some(parent.clone())
    );
    repo.delete(&parent, reply.id).await.unwrap();
    assert_eq!(repo.parent_of(reply.id).await.unwrap(), None);
    assert_eq!(repo.parent_of(Uuid::now_v7()).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn spreadsheet_threads_round_trip_resolve_and_delete(pool: PgPool) {
    setup(&pool).await;
    sqlx::query!(r#"UPDATE "Document" SET "fileType" = 'spreadsheet' WHERE id = 'message-doc-a'"#)
        .execute(&pool)
        .await
        .unwrap();
    let repo = PgMessageRepository::new(pool);
    assert_eq!(
        repo.document_file_type("message-doc-a")
            .await
            .unwrap()
            .as_deref(),
        Some("spreadsheet")
    );
    let mut create = command("message-doc-a", None, "Check the budget");
    create.input.anchor = Some(NewThreadAnchor::Spreadsheet {
        sheet_id: "sheet-1".into(),
        sheet_name: "Budget".into(),
        range: "B4:C9".into(),
    });
    let expected = create.input.anchor.as_ref().unwrap().reference();
    let root = repo.create(create).await.unwrap();
    let state = repo.thread(&root.parent, root.id).await.unwrap().unwrap();
    assert_eq!(state.anchor, Some(expected.clone()));
    repo.create(command("message-doc-a", Some(root.id), "Looks good"))
        .await
        .unwrap();
    let page = repo
        .timeline(
            &root.parent,
            MessageTimelineQuery {
                anchored: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].state.anchor, Some(expected.clone()));
    assert_eq!(page.items[0].thread.reply_count, 1);
    let state = repo
        .patch_thread(
            &root.parent,
            root.id,
            ThreadPatch {
                resolved: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(state.resolved);
    assert_eq!(state.anchor, Some(expected));
    let state = repo.delete_thread(&root.parent, root.id).await.unwrap();
    assert!(state.deleted_at.is_some());
    assert!(
        repo.timeline(&root.parent, MessageTimelineQuery::default())
            .await
            .unwrap()
            .items
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fig_threads_round_trip_on_layers_and_the_canvas(pool: PgPool) {
    // The repository stores what the service validated; the service owns the
    // design-file check, so the document's file type does not matter here.
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let mut threads = Vec::new();
    for (text, node_id, x, y) in [
        ("On the button", Some("12:34"), 18.5, -4.25),
        ("On the canvas", None, 1024.0, 768.0),
    ] {
        let mut create = command("message-doc-a", None, text);
        create.input.anchor = Some(NewThreadAnchor::Fig {
            page_id: "0:1".into(),
            node_id: node_id.map(str::to_owned),
            x,
            y,
        });
        let anchor = create.input.anchor.as_ref().unwrap().reference();
        let root = repo.create(create).await.unwrap();
        let state = repo.thread(&root.parent, root.id).await.unwrap().unwrap();
        assert_eq!(state.anchor.as_ref(), Some(&anchor));
        threads.push((root, anchor));
    }
    let stored = sqlx::query_scalar!(
        r#"SELECT anchor AS "anchor!" FROM comms_message_threads WHERE root_id = $1"#,
        threads[1].0.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        stored,
        serde_json::json!({
            "type": "fig", "pageId": "0:1", "nodeId": null, "x": 1024.0, "y": 768.0
        })
    );

    let (root, anchor) = &threads[0];
    repo.create(command("message-doc-a", Some(root.id), "Fixed"))
        .await
        .unwrap();
    let page = repo
        .timeline(
            &root.parent,
            MessageTimelineQuery {
                anchored: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(page.items.len(), 2);
    let item = page
        .items
        .iter()
        .find(|item| item.message.id == root.id)
        .unwrap();
    assert_eq!(item.state.anchor.as_ref(), Some(anchor));
    assert_eq!(item.thread.reply_count, 1);
    let state = repo
        .patch_thread(
            &root.parent,
            root.id,
            ThreadPatch {
                resolved: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(state.resolved);
    assert_eq!(state.anchor.as_ref(), Some(anchor));
    let state = repo.delete_thread(&root.parent, root.id).await.unwrap();
    assert!(state.deleted_at.is_some());
    let remaining = repo
        .timeline(&root.parent, MessageTimelineQuery::default())
        .await
        .unwrap()
        .items;
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].state.anchor.as_ref(), Some(&threads[1].1));
}

async fn setup_call_chat(pool: &PgPool) -> Uuid {
    setup(pool).await;
    let call_id = macro_uuid::generate_uuid_v7();
    let channel_id = macro_uuid::generate_uuid_v7();
    let permission_id = macro_uuid::generate_uuid_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO comms_channels (id, name, channel_type, owner_id)
        VALUES ($1, 'Call chat test', 'public', $2)"#,
        channel_id,
        USER
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "SharePermission" (id) VALUES ($1)"#,
        permission_id
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO calls (id, channel_id, room_name, created_by, share_permission_id)
        VALUES ($1, $2::uuid, $2::uuid::text, $3, $4)"#,
        call_id,
        channel_id,
        USER,
        permission_id
    )
    .execute(pool)
    .await
    .unwrap();
    call_id
}

fn call_message(call_id: Uuid, content: &str) -> CreateMessage {
    let mut command = command("message-doc-a", None, content);
    command.parent = MessageParent::Call(call_id);
    command.canonical_root_id = Some(call_id);
    command
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_first_call_messages_share_one_thread(pool: PgPool) {
    let call_id = setup_call_chat(&pool).await;
    let repo = PgMessageRepository::new(pool);
    let (first, second) = tokio::join!(
        repo.create(call_message(call_id, "First participant")),
        repo.create(call_message(call_id, "Second participant")),
    );
    let first = first.unwrap();
    let second = second.unwrap();
    assert_eq!(first.root_id(), call_id);
    assert_eq!(second.root_id(), call_id);
    assert_ne!(first.id, second.id);
    assert_ne!(first.thread_id.is_none(), second.thread_id.is_none());
    let parent = MessageParent::Call(call_id);
    assert_eq!(
        repo.timeline(&parent, Default::default())
            .await
            .unwrap()
            .items
            .len(),
        1
    );
    assert_eq!(repo.replies(&parent, call_id).await.unwrap().len(), 1);
    assert!(
        repo.get(&MessageParent::Call(Uuid::from_u128(7)), call_id)
            .await
            .unwrap()
            .is_none()
    );
    repo.delete(&parent, call_id).await.unwrap();
    let after_delete = repo
        .create(call_message(call_id, "After the first message was deleted"))
        .await
        .unwrap();
    assert_eq!(after_delete.thread_id, Some(call_id));
    assert!(
        repo.thread(&parent, call_id)
            .await
            .unwrap()
            .unwrap()
            .deleted_at
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn call_chat_survives_archiving_and_is_removed_with_the_record(pool: PgPool) {
    let call_id = setup_call_chat(&pool).await;
    verify_call_chat_archive(pool, call_id).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn quick_call_chat_survives_archiving(pool: PgPool) {
    let call_id = setup_meeting_chat(&pool, false).await;
    verify_call_chat_archive(pool, call_id).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn scheduled_call_chat_survives_archiving(pool: PgPool) {
    let call_id = setup_meeting_chat(&pool, true).await;
    verify_call_chat_archive(pool, call_id).await;
}

async fn setup_meeting_chat(pool: &PgPool, scheduled: bool) -> Uuid {
    let call_id = setup_call_chat(pool).await;
    let meeting_id = macro_uuid::generate_uuid_v7();
    let start = scheduled.then(chrono::Utc::now);
    let end = start.map(|start| start + chrono::Duration::hours(1));
    sqlx::query!(
        r#"INSERT INTO call_meetings (id, share_token, user_id, title, scheduled_start, scheduled_end, active_call_id)
        VALUES ($1, $1::uuid::text, $2, 'Standalone chat', $3, $4, $5)"#,
        meeting_id, USER, start, end, call_id
    ).execute(pool).await.unwrap();
    sqlx::query!(
        "UPDATE calls SET channel_id = NULL, meeting_id = $2 WHERE id = $1",
        call_id,
        meeting_id
    )
    .execute(pool)
    .await
    .unwrap();
    call_id
}

async fn verify_call_chat_archive(pool: PgPool, call_id: Uuid) {
    let repo = PgMessageRepository::new(pool.clone());
    let mut input = call_message(call_id, "Persistent chat");
    input.input.mentions.push(SimpleMention {
        entity_type: "user".into(),
        entity_id: USER.into(),
    });
    repo.create(input).await.unwrap();
    let parent = MessageParent::Call(call_id);
    let mut tx = pool.begin().await.unwrap();
    sqlx::query!(r#"INSERT INTO call_records (id, channel_id, room_name, created_by, started_at, duration_ms, share_permission_id, meeting_id)
        SELECT id, channel_id, room_name, created_by, created_at, 1000, share_permission_id, meeting_id FROM calls WHERE id = $1"#, call_id)
        .execute(&mut *tx).await.unwrap();
    sqlx::query!("DELETE FROM calls WHERE id = $1", call_id)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(repo.parent_exists(&parent).await.unwrap());
    assert_eq!(
        repo.get(&parent, call_id).await.unwrap().unwrap().content,
        "Persistent chat"
    );
    repo.create(call_message(call_id, "Archived reply"))
        .await
        .unwrap();
    sqlx::query!("DELETE FROM call_records WHERE id = $1", call_id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!repo.parent_exists(&parent).await.unwrap());
    assert!(repo.get(&parent, call_id).await.unwrap().is_none());
    assert!(repo.thread(&parent, call_id).await.unwrap().is_none());
    let mention_count = sqlx::query_scalar!(
        "SELECT count(*) FROM comms_entity_mentions WHERE source_entity_type = 'message' AND source_entity_id = $1",
        call_id.to_string(),
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(mention_count, Some(0));
    assert!(matches!(
        repo.create(call_message(call_id, "Deleted parent")).await,
        Err(MessageError::NotFound)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retrying_first_call_message_cannot_append_it_twice(pool: PgPool) {
    let call_id = setup_call_chat(&pool).await;
    let repo = PgMessageRepository::new(pool);
    let mut input = call_message(call_id, "First message");
    input.input.id = Some(macro_uuid::generate_uuid_v7());
    let client_message_id = input.input.id.unwrap();
    let actor = input.actor.clone();
    let parent = input.parent.clone();
    let first = repo.create(input.clone()).await.unwrap();
    assert_eq!(first.id, call_id);
    assert!(matches!(
        repo.create(input).await,
        Err(MessageError::Conflict)
    ));
    assert!(
        repo.replies(&MessageParent::Call(call_id), call_id)
            .await
            .unwrap()
            .is_empty()
    );
    let recovered = repo
        .get_by_client_message_id(&parent, &actor, client_message_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(recovered.id, call_id);
    assert_eq!(recovered.content, "First message");
    for (parent, actor) in [
        (
            MessageParent::Call(macro_uuid::generate_uuid_v7()),
            actor.clone(),
        ),
        (
            parent.clone(),
            "macro|other@example.com".to_owned().try_into().unwrap(),
        ),
    ] {
        assert!(
            repo.get_by_client_message_id(&parent, &actor, client_message_id)
                .await
                .unwrap()
                .is_none()
        );
    }
    repo.delete(&parent, call_id).await.unwrap();
    let deleted = repo
        .get_by_client_message_id(&parent, &actor, client_message_id)
        .await
        .unwrap()
        .unwrap();
    assert!(deleted.deleted_at.is_some());
    assert!(deleted.content.is_empty());
}
