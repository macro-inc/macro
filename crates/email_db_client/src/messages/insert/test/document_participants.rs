//! A re-synced message whose attachment is linked to a document keeps the
//! document's participants in `document_email_participants`. The message
//! upsert sets `from_contact_id` on every conflict that changes the row, and
//! the sender trigger's `WHEN` clause runs it only when that contact changes.

use super::*;
use std::collections::BTreeSet;

/// Calls to each trigger function, counted with `track_functions` set. Like
/// [`MessageWrites`], the counters include unflushed calls of earlier
/// transactions on the connection, so compare against a baseline.
#[derive(Debug, Default, PartialEq, Eq)]
struct TriggerCalls {
    sender_changed: i64,
    recipients_added: i64,
    recorded: i64,
}

impl TriggerCalls {
    fn since(self, baseline: &TriggerCalls) -> TriggerCalls {
        TriggerCalls {
            sender_changed: self.sender_changed - baseline.sender_changed,
            recipients_added: self.recipients_added - baseline.recipients_added,
            recorded: self.recorded - baseline.recorded,
        }
    }
}

async fn trigger_calls(tx: &mut sqlx::PgConnection) -> anyhow::Result<TriggerCalls> {
    let row = sqlx::query!(
        r#"SELECT
            COALESCE(pg_stat_get_xact_function_calls(
                'document_email_participants_sender_changed'::regproc), 0) AS "sender_changed!",
            COALESCE(pg_stat_get_xact_function_calls(
                'document_email_participants_recipients_added'::regproc), 0) AS "recipients_added!",
            COALESCE(pg_stat_get_xact_function_calls(
                'record_document_email_participants'::regproc), 0) AS "recorded!""#
    )
    .fetch_one(&mut *tx)
    .await?;
    Ok(TriggerCalls {
        sender_changed: row.sender_changed,
        recipients_added: row.recipients_added,
        recorded: row.recorded,
    })
}

async fn participants(pool: &PgPool, document: &str) -> anyhow::Result<BTreeSet<String>> {
    Ok(sqlx::query_scalar!(
        "SELECT address FROM document_email_participants WHERE document_id = $1",
        document,
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect())
}

/// Links a new document to a new attachment of `message_id`.
async fn link_document(pool: &PgPool, message_id: Uuid) -> anyhow::Result<String> {
    let attachment = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_attachments (id, message_id, provider_attachment_id) VALUES ($1, $2, 'attachment')",
        attachment,
        message_id,
    )
    .execute(pool)
    .await?;
    let document = Uuid::now_v7().to_string();
    let mut tx = pool.begin().await?;
    // No owner behind the foreign key.
    sqlx::query!("SET LOCAL session_replication_role = 'replica'")
        .execute(&mut *tx)
        .await?;
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner) VALUES ($1, 'attached.pdf', 'macro|nobody@example.com')"#,
        document,
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!("SET LOCAL session_replication_role = 'origin'")
        .execute(&mut *tx)
        .await?;
    sqlx::query!(
        "INSERT INTO document_email (document_id, email_attachment_id) VALUES ($1, $2)",
        document,
        attachment,
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(document)
}

/// Re-syncs `message` through the sync's own transaction, counting the
/// message's row updates and the trigger calls it made.
async fn resync(
    pool: &PgPool,
    message: &mut message::Message,
) -> anyhow::Result<(MessageWrites, TriggerCalls)> {
    let link_id = message.link_id;
    let thread_db_id = message.thread_db_id;
    let recipients = contacts::upsert_message::parse_and_upsert_message_contacts(
        pool,
        link_id,
        addresses_from_message(message),
    )
    .await?;
    let mut tx = pool.begin().await?;
    sqlx::query!("SET LOCAL track_functions = 'all'")
        .execute(&mut *tx)
        .await?;
    let writes = message_writes(&mut tx).await?;
    let calls = trigger_calls(&mut tx).await?;
    insert_message_with_tx(
        &mut tx,
        thread_db_id,
        message,
        link_id,
        recipients,
        true,
        None,
    )
    .await?;
    let counted = (
        message_writes(&mut tx).await?.since(&writes),
        trigger_calls(&mut tx).await?.since(&calls),
    );
    tx.commit().await?;
    Ok(counted)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("links", "threads"))
)]
async fn a_resync_records_a_new_sender_and_skips_an_unchanged_one(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str(LINK_ID)?;
    let thread_db_id = Uuid::parse_str(THREAD_ID)?;
    let synced = SyncedMessage {
        provider_id: "attached",
        global_id: "<attached@macro.com>",
        in_reply_to: None,
        to: &["user1@macro.com"],
        cc: &[],
        labels: &[],
        body: "body",
    };
    let mut first = synced.build(link_id, thread_db_id);
    let message_id = first.db_id;
    insert_message(&pool, thread_db_id, &mut first, link_id, true, None).await?;
    let document = link_document(&pool, message_id).await?;
    let first_participants = BTreeSet::from(["sender@macro.com".into(), "user1@macro.com".into()]);
    assert_eq!(participants(&pool, &document).await?, first_participants);

    // Identical: the upsert's WHERE skips the row, so no trigger on it runs.
    // The recipient insert conflicts on every row, so its statement trigger
    // sees no new recipient and records nothing.
    let (writes, calls) = resync(&pool, &mut synced.build(link_id, thread_db_id)).await?;
    assert_eq!(writes.updated, 0);
    assert_eq!(
        calls,
        TriggerCalls {
            sender_changed: 0,
            recipients_added: 1,
            recorded: 0,
        }
    );

    // A changed flag updates the row; the sender's WHEN clause skips it.
    let mut read = synced.build(link_id, thread_db_id);
    read.is_read = true;
    let (writes, calls) = resync(&pool, &mut read).await?;
    assert_eq!(writes.updated, 1);
    assert_eq!(
        calls,
        TriggerCalls {
            sender_changed: 0,
            recipients_added: 1,
            recorded: 0,
        }
    );

    // A new sender runs it once, and the document lists the new sender too.
    let mut resent = synced.build(link_id, thread_db_id);
    resent.from = Some(contact("Other@Macro.com"));
    let (writes, calls) = resync(&pool, &mut resent).await?;
    assert_eq!(writes.updated, 1);
    assert_eq!(
        calls,
        TriggerCalls {
            sender_changed: 1,
            recipients_added: 1,
            recorded: 1,
        }
    );
    let mut with_new_sender = first_participants;
    with_new_sender.insert("other@macro.com".into());
    assert_eq!(participants(&pool, &document).await?, with_new_sender);
    Ok(())
}
