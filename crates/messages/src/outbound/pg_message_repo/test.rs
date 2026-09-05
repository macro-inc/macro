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
    let page = repo.list(&parent, None, 10).await.unwrap();
    assert_eq!(page.threads.len(), 1);
    assert!(page.threads[0].root.content.is_empty());
    assert_eq!(page.threads[0].replies[0].content, "reply");
    repo.create(command(
        "message-doc-a",
        Some(root.id),
        "reply to tombstone",
    ))
    .await
    .unwrap();
    repo.delete_thread(&parent, root.id).await.unwrap();
    assert!(
        repo.list(&parent, None, 10)
            .await
            .unwrap()
            .threads
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
        repo.resolve(&root.parent, root.id, true)
            .await
            .unwrap()
            .resolved
    );
    let edit = EditMessage {
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
    let first = repo.list(&root.parent, None, 1).await.unwrap();
    let second = repo.list(&root.parent, first.next_cursor, 1).await.unwrap();
    assert_eq!(first.threads.len(), 1);
    assert_eq!(second.threads.len(), 1);
    assert_ne!(first.threads[0].root.id, second.threads[0].root.id);
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
        repo.list(&create.parent, None, 10)
            .await
            .unwrap()
            .threads
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
