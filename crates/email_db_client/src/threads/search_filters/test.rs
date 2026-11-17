use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::collections::HashSet;

const VIEWER: &str = "macro|viewer@corp.test";
const OTHER: &str = "macro|other@corp.test";

async fn insert_link(pool: &PgPool) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, $3, 'GMAIL')"#,
        id,
        VIEWER,
        format!("viewer+{id}@corp.test"),
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_thread(
    pool: &PgPool,
    link_id: Uuid,
    is_read: bool,
    inbox_visible: bool,
    has_calendar_attachment: bool,
) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_threads (id, link_id, is_read, inbox_visible, has_calendar_attachment)
           VALUES ($1, $2, $3, $4, $5)"#,
        id,
        link_id,
        is_read,
        inbox_visible,
        has_calendar_attachment,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn notify(pool: &PgPool, user_id: &str, thread_id: Uuid, state: &str, deleted: bool) {
    let notification_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO notification
               (id, notification_event_type, event_item_id, event_item_type, service_sender)
           VALUES ($1, 'new_email', $2, 'email_thread', 'email_service')"#,
        notification_id,
        thread_id.to_string(),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO user_notification
               (user_id, notification_id, state, event_item_type, event_item_id, deleted_at)
           VALUES ($1, $2, $3::text::notification_state, 'email_thread', $4,
                   CASE WHEN $5 THEN now() END)"#,
        user_id,
        notification_id,
        state,
        thread_id.to_string(),
        deleted,
    )
    .execute(pool)
    .await
    .unwrap();
}

struct Threads {
    unread: Uuid,
    read: Uuid,
    done: Uuid,
    invite: Uuid,
}

async fn threads(pool: &PgPool) -> Threads {
    let link = insert_link(pool).await;
    Threads {
        unread: insert_thread(pool, link, false, true, false).await,
        read: insert_thread(pool, link, true, true, false).await,
        done: insert_thread(pool, link, true, false, false).await,
        invite: insert_thread(pool, link, false, true, true).await,
    }
}

async fn matching(
    pool: &PgPool,
    threads: &Threads,
    filter: ThreadStateFilter,
) -> anyhow::Result<HashSet<Uuid>> {
    let ids = [threads.unread, threads.read, threads.done, threads.invite];
    Ok(thread_ids_matching_states(pool, &ids, VIEWER, &filter)
        .await?
        .into_iter()
        .collect())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn each_state_keeps_only_matching_threads(pool: PgPool) -> anyhow::Result<()> {
    let t = threads(&pool).await;

    assert_eq!(
        matching(
            &pool,
            &t,
            ThreadStateFilter {
                is_read: Some(false),
                ..Default::default()
            }
        )
        .await?,
        HashSet::from([t.unread, t.invite])
    );
    assert_eq!(
        matching(
            &pool,
            &t,
            ThreadStateFilter {
                inbox_visible: Some(false),
                ..Default::default()
            }
        )
        .await?,
        HashSet::from([t.done])
    );
    assert_eq!(
        matching(
            &pool,
            &t,
            ThreadStateFilter {
                calendar_only: true,
                ..Default::default()
            }
        )
        .await?,
        HashSet::from([t.invite])
    );
    assert_eq!(
        matching(
            &pool,
            &t,
            ThreadStateFilter {
                is_read: Some(true),
                inbox_visible: Some(true),
                ..Default::default()
            }
        )
        .await?,
        HashSet::from([t.read])
    );
    assert_eq!(
        matching(&pool, &t, ThreadStateFilter::default()).await?,
        HashSet::from([t.unread, t.read, t.done, t.invite])
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn notification_states_are_the_viewers_live_ones(pool: PgPool) -> anyhow::Result<()> {
    let t = threads(&pool).await;
    notify(&pool, VIEWER, t.unread, "unseen", false).await;
    notify(&pool, VIEWER, t.read, "done", false).await;
    notify(&pool, VIEWER, t.done, "unseen", true).await;
    notify(&pool, OTHER, t.invite, "unseen", false).await;

    assert_eq!(
        matching(
            &pool,
            &t,
            ThreadStateFilter {
                notification_states: vec!["unseen".into(), "seen".into()],
                ..Default::default()
            }
        )
        .await?,
        HashSet::from([t.unread])
    );
    assert_eq!(
        matching(
            &pool,
            &t,
            ThreadStateFilter {
                notification_states: vec!["done".into()],
                ..Default::default()
            }
        )
        .await?,
        HashSet::from([t.read])
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn calendar_threads_come_from_the_given_inboxes_up_to_the_limit(
    pool: PgPool,
) -> anyhow::Result<()> {
    let t = threads(&pool).await;
    let other_link = insert_link(&pool).await;
    insert_thread(&pool, other_link, false, true, true).await;
    let link = sqlx::query_scalar!("SELECT link_id FROM email_threads WHERE id = $1", t.invite)
        .fetch_one(&pool)
        .await?;

    assert_eq!(
        calendar_thread_ids(&pool, &[link], 100).await?,
        vec![t.invite]
    );
    assert_eq!(
        calendar_thread_ids(&pool, &[link, other_link], 1)
            .await?
            .len(),
        1
    );
    assert!(calendar_thread_ids(&pool, &[], 100).await?.is_empty());
    Ok(())
}

async fn insert_message(
    pool: &PgPool,
    thread_id: Uuid,
    is_draft: bool,
    is_sent: bool,
    mailbox_state: Option<serde_json::Value>,
) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_messages (id, thread_id, link_id, is_draft, is_sent, mailbox_state)
           SELECT $1, t.id, t.link_id, $3, $4, $5 FROM email_threads t WHERE t.id = $2"#,
        id,
        thread_id,
        is_draft,
        is_sent,
        mailbox_state,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn attach(pool: &PgPool, message_id: Uuid, mime_type: &str) {
    sqlx::query!(
        r#"INSERT INTO email_attachments (id, message_id, provider_attachment_id, mime_type)
           VALUES ($1, $2, 'attachment', $3)"#,
        Uuid::now_v7(),
        message_id,
        mime_type,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn mark_sent(pool: &PgPool, thread_id: Uuid) {
    sqlx::query!(
        "UPDATE email_threads SET latest_outbound_message_ts = now() WHERE id = $1",
        thread_id
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn link_of(pool: &PgPool, thread_id: Uuid) -> Uuid {
    sqlx::query_scalar!("SELECT link_id FROM email_threads WHERE id = $1", thread_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sent_keeps_threads_with_a_sent_message(pool: PgPool) -> anyhow::Result<()> {
    let t = threads(&pool).await;
    mark_sent(&pool, t.read).await;

    assert_eq!(
        matching(
            &pool,
            &t,
            ThreadStateFilter {
                sent: true,
                ..Default::default()
            }
        )
        .await?,
        HashSet::from([t.read])
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn drafts_keep_threads_with_a_present_draft_outside_the_trash(
    pool: PgPool,
) -> anyhow::Result<()> {
    let t = threads(&pool).await;
    insert_message(&pool, t.unread, false, false, None).await;
    insert_message(&pool, t.unread, true, false, None).await;
    insert_message(
        &pool,
        t.read,
        true,
        false,
        Some(serde_json::json!({ "in_trash": true })),
    )
    .await;
    insert_message(
        &pool,
        t.done,
        true,
        false,
        Some(serde_json::json!({ "provider_missing": true })),
    )
    .await;
    insert_message(&pool, t.invite, false, true, None).await;

    let filter = ThreadStateFilter {
        has_draft: true,
        ..Default::default()
    };
    assert_eq!(
        matching(&pool, &t, filter).await?,
        HashSet::from([t.unread])
    );

    let link = link_of(&pool, t.unread).await;
    assert_eq!(draft_thread_ids(&pool, &[link], 100).await?, vec![t.unread]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn attachment_kinds_match_any_attachment_of_any_message(pool: PgPool) -> anyhow::Result<()> {
    let t = threads(&pool).await;
    insert_message(&pool, t.unread, false, false, None).await;
    let unread_reply = insert_message(&pool, t.unread, false, true, None).await;
    attach(&pool, unread_reply, "application/pdf").await;
    let read = insert_message(&pool, t.read, false, false, None).await;
    attach(&pool, read, "image/png").await;
    let trashed = insert_message(
        &pool,
        t.done,
        false,
        false,
        Some(serde_json::json!({ "in_trash": true })),
    )
    .await;
    attach(
        &pool,
        trashed,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    .await;
    let invite = insert_message(&pool, t.invite, false, false, None).await;
    attach(&pool, invite, "text/calendar").await;

    let kinds = |attachment_kinds| ThreadStateFilter {
        attachment_kinds,
        ..Default::default()
    };
    assert_eq!(
        matching(&pool, &t, kinds(vec![ThreadAttachmentKind::Pdf])).await?,
        HashSet::from([t.unread])
    );
    assert_eq!(
        matching(
            &pool,
            &t,
            kinds(vec![
                ThreadAttachmentKind::Image,
                ThreadAttachmentKind::Document
            ])
        )
        .await?,
        HashSet::from([t.read, t.done])
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sent_threads_come_from_the_given_inboxes_up_to_the_limit(
    pool: PgPool,
) -> anyhow::Result<()> {
    let t = threads(&pool).await;
    mark_sent(&pool, t.read).await;
    mark_sent(&pool, t.done).await;
    let other_link = insert_link(&pool).await;
    let elsewhere = insert_thread(&pool, other_link, true, true, false).await;
    mark_sent(&pool, elsewhere).await;
    let link = link_of(&pool, t.read).await;

    let sent: HashSet<Uuid> = sent_thread_ids(&pool, &[link], 100)
        .await?
        .into_iter()
        .collect();
    assert_eq!(sent, HashSet::from([t.read, t.done]));
    assert_eq!(
        sent_thread_ids(&pool, &[link, other_link], 2).await?.len(),
        2
    );
    assert!(sent_thread_ids(&pool, &[], 100).await?.is_empty());
    Ok(())
}
