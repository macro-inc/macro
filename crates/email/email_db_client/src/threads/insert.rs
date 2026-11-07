#[cfg(test)]
mod test;

use crate::messages::replying_to_id::update_thread_messages_replying_to;
use crate::parse::service_to_db::addresses_from_message;
use crate::{contacts, messages, parse};

use models_email::email::db::address::UpsertedRecipients;
use models_email::email::service::{message, thread};
use sqlx::types::Uuid;
use sqlx::{PgConnection, PgPool};
use std::collections::HashMap;

/// inserts a thread and all of its messages into the database
/// returns the db thread id
#[tracing::instrument(
    skip(pool, service_thread),
    fields(
        thread_provider_id = %service_thread.provider_id.clone().unwrap_or_default(),
        link_id = %link_id
    ),
    err
)]
pub async fn insert_thread_and_messages(
    pool: &PgPool,
    service_thread: thread::Thread,
    link_id: Uuid,
) -> anyhow::Result<Uuid> {
    let mut recipient_map: HashMap<String, UpsertedRecipients> = HashMap::new();

    // we have to insert addresses before inserting the messages. these values are shared
    // across messages, so inserting them in the txn can cause deadlocks.
    for message in service_thread.messages.iter() {
        let addresses = addresses_from_message(message);

        let recipients =
            contacts::upsert_message::parse_and_upsert_message_contacts(pool, link_id, addresses)
                .await?;

        // can't be null bc we are getting the message from gmail api directly
        recipient_map.insert(message.provider_id.clone().unwrap(), recipients);
    }

    let mut tx = pool.begin().await?;

    let result = async {
        // Insert thread
        let thread_id = insert_thread(&mut tx, &service_thread, link_id).await?;

        // Insert all messages
        for mut message in service_thread.messages.clone() {
            // can't be null bc we are getting the message from gmail api directly
            let provider_id = &message.provider_id.clone().unwrap();
            messages::insert::insert_message_with_tx(
                &mut tx,
                thread_id,
                &mut message,
                link_id,
                recipient_map.remove(provider_id).unwrap(),
                false,
                None,
            )
            .await?;
        }

        // Now that messages have been inserted, we can set replying_to_ids of messages for threads
        // with more than one message. If a thread only has one message, we know it will have no
        // messages replying to other messages and thus no replying_to_ids.
        if service_thread.messages.len() > 1 {
            update_thread_messages_replying_to(&mut tx, thread_id, link_id).await?;
        }

        // Messages were inserted with per-message metadata updates disabled, and
        // insert_thread precomputes the thread columns from Gmail's labels only
        // for a new thread. Recompute them, and is_signal, from the stored
        // labels, which keep pending Macro writes and newly synced messages.
        super::update::update_thread_metadata(&mut tx, thread_id, link_id).await?;

        Ok(thread_id)
    }
    .await;

    if let Err(err) = result {
        if let Err(rollback_err) = tx.rollback().await {
            anyhow::bail!(
                "Transaction failed: {} AND rollback also failed: {}",
                err,
                rollback_err
            );
        }
        return Err(err);
    }

    tx.commit().await?;

    Ok(result.unwrap())
}

/// inserts a thread object into the database using the provided transaction
///
/// On conflict the update is skipped entirely when it would be a no-op
/// (incoming `latest_inbound_message_ts` is NULL or unchanged), so redelivered
/// backfill/sync work neither rewrites the row nor wipes a populated
/// timestamp with NULL.
#[tracing::instrument(skip(conn, service_thread), err)]
pub async fn insert_thread(
    conn: &mut PgConnection,
    service_thread: &thread::Thread,
    link_id: Uuid,
) -> anyhow::Result<Uuid> {
    if let Some(provider_id) = service_thread.provider_id.as_deref() {
        super::provider_identity::lock_provider_thread(conn, link_id, provider_id).await?;
    }
    let db_thread = parse::service_to_db::map_service_thread_to_db(service_thread, link_id);

    let result = sqlx::query_scalar!(
        r#"
        INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, latest_inbound_message_ts,
                             latest_outbound_message_ts, latest_non_spam_message_ts)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (link_id, provider_id) WHERE provider_id IS NOT NULL DO UPDATE
        SET
            latest_inbound_message_ts = EXCLUDED.latest_inbound_message_ts,
            updated_at = NOW()
        WHERE
            EXCLUDED.latest_inbound_message_ts IS NOT NULL AND
            email_threads.latest_inbound_message_ts IS DISTINCT FROM EXCLUDED.latest_inbound_message_ts
        RETURNING id
        "#,
        db_thread.id,
        db_thread.provider_id,
        db_thread.link_id,
        db_thread.inbox_visible,
        db_thread.is_read,
        db_thread.latest_inbound_message_ts,
        db_thread.latest_outbound_message_ts,
        db_thread.latest_non_spam_message_ts,
    )
        .fetch_optional(&mut *conn)
        .await?;

    if let Some(id) = result {
        return Ok(id);
    }

    // The conflicting row already holds this data; fetch its id.
    let existing_id = sqlx::query_scalar!(
        r#"
        SELECT id FROM email_threads
        WHERE link_id = $1 AND provider_id = $2
        "#,
        db_thread.link_id,
        db_thread.provider_id,
    )
    .fetch_one(&mut *conn)
    .await?;

    Ok(existing_id)
}

/// A thread row with no metadata yet, for writers that fill it in afterwards.
fn blank_thread(thread_provider_id: &str, link_id: Uuid) -> thread::Thread {
    thread::Thread {
        db_id: macro_uuid::generate_uuid_v7(),
        provider_id: Some(thread_provider_id.to_string()),
        link_id,
        inbox_visible: false,
        is_read: false,
        latest_inbound_message_ts: None,
        latest_outbound_message_ts: None,
        latest_non_spam_message_ts: None,
        created_at: Default::default(),
        updated_at: Default::default(),
        messages: vec![],
    }
}

/// Inserts a thread with no metadata, returning its id, or `None` when the
/// mailbox already has the thread, including when a concurrent insert won.
#[tracing::instrument(skip(pool), err)]
pub async fn insert_blank_thread(
    pool: &PgPool,
    thread_provider_id: &str,
    link_id: Uuid,
) -> anyhow::Result<Option<Uuid>> {
    let thread = blank_thread(thread_provider_id, link_id);

    let mut tx = pool.begin().await?;
    let id = insert_thread(&mut tx, &thread, link_id).await?;
    tx.commit().await?;
    Ok((id == thread.db_id).then_some(id))
}

/// Inserts a backfilled thread and all of its messages in one transaction,
/// returning the thread id and the messages it skipped, or `None` when the
/// mailbox already has the thread, including when a concurrent insert won;
/// nothing is written then.
///
/// A message `is_unstorable` rejects is left out under its own savepoint while
/// the rest commit. Any other failure leaves no thread behind, so a retried
/// backfill writes the whole thread again. Thread metadata and `replying_to`
/// links are left to the backfill's metadata step, as with
/// [`insert_blank_thread`].
#[tracing::instrument(skip(pool, messages, is_unstorable), fields(message_count = messages.len()), err)]
pub async fn insert_backfilled_thread(
    pool: &PgPool,
    thread_provider_id: &str,
    link_id: Uuid,
    messages: &mut [message::Message],
    is_unstorable: impl Fn(&anyhow::Error) -> bool,
) -> anyhow::Result<Option<(Uuid, Vec<messages::insert::SkippedMessage>)>> {
    let writer = messages::insert::BackfillMessageWriter {
        pool,
        link_id,
        is_unstorable,
    };
    let mut skipped = Vec::new();
    let recipients = writer.upsert_contacts(messages, &mut skipped).await?;
    let thread = blank_thread(thread_provider_id, link_id);

    let mut tx = pool.begin().await?;
    let id = insert_thread(&mut tx, &thread, link_id).await?;
    if id != thread.db_id {
        tx.rollback().await?;
        return Ok(None);
    }
    writer
        .insert_messages(&mut tx, id, messages, recipients, &mut skipped)
        .await?;
    tx.commit().await?;
    Ok(Some((id, skipped)))
}
