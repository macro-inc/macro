use super::*;
use crate::threads::get::get_thread_by_id_and_link_id;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use std::time::Duration;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn provider_thread_upsert_advances_existing_thread_timestamp(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let existing_thread_id = Uuid::parse_str("10000000-0000-0000-0000-000000000001")?;
    let mut conflicting_thread = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should exist");
    let updated_at_before = conflicting_thread.updated_at;

    tokio::time::sleep(Duration::from_millis(10)).await;

    conflicting_thread.db_id = Uuid::parse_str("20000000-0000-0000-0000-000000000001")?;
    conflicting_thread.latest_inbound_message_ts = Some(Utc::now());

    let upserted_thread_id =
        insert_thread(&mut *pool.acquire().await?, &conflicting_thread, link_id).await?;

    assert_eq!(upserted_thread_id, existing_thread_id);
    let thread_after = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should still exist");
    assert!(
        thread_after.updated_at > updated_at_before,
        "provider thread upsert should advance the existing thread timestamp"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn unchanged_timestamp_upsert_is_noop(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let existing_thread_id = Uuid::parse_str("10000000-0000-0000-0000-000000000001")?;

    // Seed a populated latest_inbound_message_ts via a real upsert.
    let mut thread = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should exist");
    thread.db_id = Uuid::parse_str("20000000-0000-0000-0000-000000000002")?;
    thread.latest_inbound_message_ts = Some(Utc::now());
    insert_thread(&mut *pool.acquire().await?, &thread, link_id).await?;

    let after_first = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should exist");
    assert!(after_first.latest_inbound_message_ts.is_some());

    tokio::time::sleep(Duration::from_millis(10)).await;

    // Re-upsert with the identical timestamp: must not rewrite the row.
    let mut duplicate = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should exist");
    duplicate.db_id = Uuid::parse_str("20000000-0000-0000-0000-000000000003")?;

    let upserted_thread_id =
        insert_thread(&mut *pool.acquire().await?, &duplicate, link_id).await?;

    assert_eq!(upserted_thread_id, existing_thread_id);
    let after_second = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should still exist");
    assert_eq!(
        after_second.updated_at, after_first.updated_at,
        "no-op upsert must not rewrite the row"
    );
    assert_eq!(
        after_second.latest_inbound_message_ts,
        after_first.latest_inbound_message_ts
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn blank_upsert_preserves_populated_timestamp(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let existing_thread_id = Uuid::parse_str("10000000-0000-0000-0000-000000000001")?;

    // Seed a populated latest_inbound_message_ts via a real upsert.
    let mut thread = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should exist");
    thread.db_id = Uuid::parse_str("20000000-0000-0000-0000-000000000004")?;
    thread.latest_inbound_message_ts = Some(Utc::now());
    insert_thread(&mut *pool.acquire().await?, &thread, link_id).await?;

    let before = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should exist");
    assert!(before.latest_inbound_message_ts.is_some());

    tokio::time::sleep(Duration::from_millis(10)).await;

    // A redelivered backfill blank insert must not wipe the timestamp or
    // rewrite the row.
    let inserted = insert_blank_thread(&pool, "prov1", link_id).await?;

    assert_eq!(inserted, None, "the mailbox already had the thread");
    let after = get_thread_by_id_and_link_id(&pool, existing_thread_id, link_id)
        .await?
        .expect("provider thread should still exist");
    assert_eq!(
        after.latest_inbound_message_ts, before.latest_inbound_message_ts,
        "blank upsert must not wipe a populated timestamp"
    );
    assert_eq!(
        after.updated_at, before.updated_at,
        "blank upsert against an existing thread must not rewrite the row"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn blank_insert_creates_new_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;

    let thread_id = insert_blank_thread(&pool, "prov-brand-new", link_id)
        .await?
        .expect("the thread is new");

    let thread = get_thread_by_id_and_link_id(&pool, thread_id, link_id)
        .await?
        .expect("blank thread should be created");
    assert_eq!(thread.provider_id.as_deref(), Some("prov-brand-new"));
    assert_eq!(thread.latest_inbound_message_ts, None);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links"))
)]
async fn only_one_of_two_concurrent_blank_inserts_creates_the_thread(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;

    let (first, second) = tokio::join!(
        insert_blank_thread(&pool, "prov-raced", link_id),
        insert_blank_thread(&pool, "prov-raced", link_id)
    );

    assert_eq!(
        [first?, second?].iter().flatten().count(),
        1,
        "only the winning insert backfills the thread's messages"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links"))
)]
async fn resyncing_an_unchanged_thread_rewrites_no_messages(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use crate::messages::insert::test::{PARENT_GLOBAL_ID, SyncedMessage, row_versions};

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let parent = SyncedMessage {
        provider_id: "thread-parent",
        global_id: PARENT_GLOBAL_ID,
        in_reply_to: None,
        to: &["user1@macro.com"],
        cc: &[],
        labels: &[],
        body: "parent body",
    };
    let reply = SyncedMessage {
        provider_id: "thread-reply",
        global_id: "<reply@macro.com>",
        in_reply_to: Some(PARENT_GLOBAL_ID),
        to: &["sender@macro.com"],
        cc: &["cc@macro.com"],
        labels: &[],
        body: "reply body",
    };
    let synced_thread = || {
        let thread_db_id = Uuid::now_v7();
        let ts =
            chrono::DateTime::<Utc>::from_timestamp(1_790_000_000, 0).expect("valid timestamp");
        thread::Thread {
            db_id: thread_db_id,
            provider_id: Some("resync-thread".to_string()),
            link_id,
            inbox_visible: true,
            is_read: false,
            latest_inbound_message_ts: Some(ts),
            latest_outbound_message_ts: None,
            latest_non_spam_message_ts: Some(ts),
            created_at: ts,
            updated_at: ts,
            messages: vec![
                parent.build(link_id, thread_db_id),
                reply.build(link_id, thread_db_id),
            ],
        }
    };

    let first_sync = synced_thread();
    let parent_id = first_sync.messages[0].db_id;
    let reply_id = first_sync.messages[1].db_id;
    let thread_id = insert_thread_and_messages(&pool, first_sync, link_id).await?;

    let replying_to = sqlx::query_scalar!(
        r#"SELECT replying_to_id FROM email_messages WHERE id = $1"#,
        reply_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(replying_to, Some(parent_id));
    let parent_before = row_versions(&pool, parent_id).await?;
    let reply_before = row_versions(&pool, reply_id).await?;

    let resynced_thread_id = insert_thread_and_messages(&pool, synced_thread(), link_id).await?;

    assert_eq!(resynced_thread_id, thread_id);
    assert_eq!(row_versions(&pool, parent_id).await?, parent_before);
    assert_eq!(
        row_versions(&pool, reply_id).await?,
        reply_before,
        "re-syncing an unchanged thread must not rewrite its messages"
    );

    Ok(())
}

/// The live inbox-sync path funnels through here, so it needs the same
/// protection from unstorable provider values as the backfill path.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links"))
)]
async fn oversized_provider_values_do_not_block_the_thread_insert(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use models_email::email::service::address::ContactInfo;
    use models_email::email::service::message;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let thread_db_id = Uuid::now_v7();
    let message_db_id = Uuid::now_v7();
    let now = Utc::now();
    let unsubscribe_address = format!(
        "v3_{}@unsubscribe-06.emailinboundprocessing.com",
        "t".repeat(460)
    );

    let thread = thread::Thread {
        db_id: thread_db_id,
        provider_id: Some("oversized-thread".to_string()),
        link_id,
        inbox_visible: true,
        is_read: false,
        latest_inbound_message_ts: Some(now),
        latest_outbound_message_ts: None,
        latest_non_spam_message_ts: Some(now),
        created_at: now,
        updated_at: now,
        messages: vec![message::Message {
            db_id: message_db_id,
            provider_id: Some("oversized-thread-message".to_string()),
            thread_db_id,
            provider_thread_id: Some("oversized-thread".to_string()),
            replying_to_id: None,
            global_id: None,
            link_id,
            subject: Some("unsubscribe".to_string()),
            snippet: None,
            provider_history_id: None,
            internal_date_ts: Some(now),
            sent_at: Some(now),
            size_estimate: Some(1),
            is_read: false,
            is_starred: false,
            is_sent: true,
            is_draft: false,
            scheduled_send_time: None,
            has_attachments: false,
            from: Some(ContactInfo {
                email: "user1@macro.com".to_string(),
                name: Some("f".repeat(400)),
                photo_url: None,
            }),
            to: vec![ContactInfo {
                email: unsubscribe_address,
                name: None,
                photo_url: None,
            }],
            cc: vec![],
            bcc: vec![],
            labels: vec![],
            body_text: Some("body".to_string()),
            body_html_sanitized: None,
            body_macro: None,
            attachments: vec![],
            attachments_draft: vec![],
            attachments_forwarded: vec![],
            headers_json: None,
            created_at: now,
            updated_at: now,
        }],
    };

    let inserted_thread_id = insert_thread_and_messages(&pool, thread, link_id).await?;

    assert_eq!(inserted_thread_id, thread_db_id);
    let from_name = sqlx::query_scalar!(
        r#"SELECT from_name FROM email_messages WHERE id = $1"#,
        message_db_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(from_name.as_deref().map(|n| n.chars().count()), Some(255));

    let recipient_count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM email_message_recipients WHERE message_id = $1"#,
        message_db_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(recipient_count, Some(0));

    Ok(())
}

fn backfilled_messages(link_id: Uuid) -> Vec<message::Message> {
    use crate::messages::insert::test::{PARENT_GLOBAL_ID, SyncedMessage};

    let parent = SyncedMessage {
        provider_id: "backfill-parent",
        global_id: PARENT_GLOBAL_ID,
        in_reply_to: None,
        to: &["user1@macro.com"],
        cc: &[],
        labels: &[],
        body: "parent body",
    };
    let reply = SyncedMessage {
        provider_id: "backfill-reply",
        global_id: "<backfill-reply@macro.com>",
        in_reply_to: Some(PARENT_GLOBAL_ID),
        to: &["sender@macro.com"],
        cc: &["cc@macro.com"],
        labels: &[],
        body: "reply body",
    };
    // Backfill writes the thread row itself, so the messages' own thread id is unused.
    let unused_thread_id = Uuid::now_v7();
    vec![
        parent.build(link_id, unused_thread_id),
        reply.build(link_id, unused_thread_id),
    ]
}

/// Postgres "data exception" (SQLSTATE class 22): the value itself can't be stored.
fn data_exception(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<sqlx::Error>()
            .and_then(|error| error.as_database_error())
            .and_then(|error| error.code())
            .is_some_and(|code| code.starts_with("22"))
    })
}

async fn thread_message_count(pool: &Pool<Postgres>, thread_id: Uuid) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM email_messages WHERE thread_id = $1"#,
        thread_id
    )
    .fetch_one(pool)
    .await?)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links"))
)]
async fn a_backfilled_thread_is_written_with_all_of_its_messages(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let mut messages = backfilled_messages(link_id);

    let (thread_id, skipped) = insert_backfilled_thread(
        &pool,
        "backfill-thread",
        link_id,
        &mut messages,
        data_exception,
    )
    .await?
    .expect("the thread is new");

    assert!(skipped.is_empty());

    assert_eq!(thread_message_count(&pool, thread_id).await?, 2);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links"))
)]
async fn a_thread_another_copy_already_wrote_gets_no_messages_from_this_one(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let existing_id = insert_blank_thread(&pool, "backfill-thread", link_id)
        .await?
        .expect("the thread is new");
    let mut messages = backfilled_messages(link_id);

    let inserted = insert_backfilled_thread(
        &pool,
        "backfill-thread",
        link_id,
        &mut messages,
        data_exception,
    )
    .await?;

    assert!(
        inserted.is_none(),
        "only the copy that wrote the thread finishes it"
    );
    assert_eq!(thread_message_count(&pool, existing_id).await?, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links"))
)]
async fn missing_messages_are_written_into_their_existing_thread(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let thread_id = insert_blank_thread(&pool, "backfill-thread", link_id)
        .await?
        .expect("the thread is new");
    let mut messages = backfilled_messages(link_id);

    let skipped = crate::messages::insert::insert_thread_messages(
        &pool,
        thread_id,
        link_id,
        &mut messages,
        data_exception,
    )
    .await?;

    assert!(skipped.is_empty());

    assert_eq!(thread_message_count(&pool, thread_id).await?, 2);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links"))
)]
async fn a_message_that_cannot_be_stored_is_skipped_and_the_rest_of_its_thread_is_written(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let mut messages = backfilled_messages(link_id);
    // Postgres text can't hold NUL, so this message fails identically every time.
    messages[0].body_text = Some("broken \0 body".to_string());

    let (thread_id, skipped) = insert_backfilled_thread(
        &pool,
        "backfill-thread",
        link_id,
        &mut messages,
        data_exception,
    )
    .await?
    .expect("the thread is new");

    assert_eq!(
        skipped
            .iter()
            .map(|skipped| skipped.index)
            .collect::<Vec<_>>(),
        vec![0]
    );
    assert_eq!(thread_message_count(&pool, thread_id).await?, 1);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links"))
)]
async fn whole_thread_resync_recomputes_thread_state_from_stored_labels(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use crate::messages::insert::test::SyncedMessage;

    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    sqlx::query!(
        "INSERT INTO email_labels (id, link_id, provider_label_id, name) VALUES ($1, $2, 'INBOX', 'INBOX')",
        Uuid::now_v7(),
        link_id
    )
    .execute(&pool)
    .await?;
    let archived = SyncedMessage {
        provider_id: "pending-archive",
        global_id: "<pending-archive@macro.com>",
        in_reply_to: None,
        to: &["user1@macro.com"],
        cc: &[],
        labels: &["INBOX"],
        body: "archived body",
    };
    let reply = SyncedMessage {
        provider_id: "new-reply",
        global_id: "<new-reply@macro.com>",
        in_reply_to: None,
        to: &["user1@macro.com"],
        cc: &[],
        labels: &["INBOX"],
        body: "reply body",
    };
    let gmail_thread = |messages: &[&SyncedMessage]| {
        let thread_db_id = Uuid::now_v7();
        let ts =
            chrono::DateTime::<Utc>::from_timestamp(1_790_000_000, 0).expect("valid timestamp");
        thread::Thread {
            db_id: thread_db_id,
            provider_id: Some("pending-archive-thread".to_string()),
            link_id,
            inbox_visible: true,
            is_read: false,
            latest_inbound_message_ts: Some(ts),
            latest_outbound_message_ts: None,
            latest_non_spam_message_ts: Some(ts),
            created_at: ts,
            updated_at: ts,
            messages: messages
                .iter()
                .map(|message| message.build(link_id, thread_db_id))
                .collect(),
        }
    };
    let first_sync = gmail_thread(&[&archived]);
    let message_id = first_sync.messages[0].db_id;
    let thread_id = insert_thread_and_messages(&pool, first_sync, link_id).await?;

    // Archived in Macro; Gmail has not applied it yet.
    let mut tx = pool.begin().await?;
    crate::labels::delete::delete_message_labels_batch(
        &mut *tx,
        &vec![message_id],
        "INBOX",
        link_id,
    )
    .await?;
    sqlx::query!(
        "UPDATE email_threads SET inbox_visible = false WHERE id = $1",
        thread_id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    crate::labels::pending_writes::mark_pending_label_writes(
        &pool,
        link_id,
        &[message_id],
        "INBOX",
        false,
        Uuid::now_v7(),
    )
    .await?;
    let inbox_visible = || async {
        get_thread_by_id_and_link_id(&pool, thread_id, link_id)
            .await
            .map(|thread| thread.expect("thread should exist").inbox_visible)
    };

    insert_thread_and_messages(&pool, gmail_thread(&[&archived]), link_id).await?;
    assert!(!inbox_visible().await?);

    // A new reply lands in the inbox, so the thread shows again.
    insert_thread_and_messages(&pool, gmail_thread(&[&archived, &reply]), link_id).await?;
    assert!(inbox_visible().await?);

    Ok(())
}
