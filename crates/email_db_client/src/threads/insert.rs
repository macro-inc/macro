#[cfg(test)]
mod test;

use crate::messages::replying_to_id::update_thread_messages_replying_to;
use crate::parse::service_to_db::addresses_from_message;
use crate::{contacts, messages, parse};

use models_email::email::db::address::UpsertedRecipients;
use models_email::email::service::thread;
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
            )
            .await?;
        }

        // Now that messages have been inserted, we can set replying_to_ids of messages for threads
        // with more than one message. If a thread only has one message, we know it will have no
        // messages replying to other messages and thus no replying_to_ids.
        if service_thread.messages.len() > 1 {
            update_thread_messages_replying_to(&mut tx, thread_id, link_id).await?;
        }

        // Messages were inserted with per-message metadata updates disabled and
        // insert_thread precomputes the other thread columns, so is_signal
        // must be synced here or new threads would stay noise.
        super::update::sync_thread_signal_flag(&mut tx, thread_id).await?;

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

/// inserts a thread object into the database that has no metadata or rizz
#[tracing::instrument(skip(pool), err)]
pub async fn insert_blank_thread(
    pool: &PgPool,
    thread_provider_id: &str,
    link_id: Uuid,
) -> anyhow::Result<Uuid> {
    let thread = thread::Thread {
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
    };

    let mut conn = pool.acquire().await?;
    insert_thread(&mut conn, &thread, link_id).await
}
