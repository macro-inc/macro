use crate::messages::replying_to_id::update_thread_messages_replying_to;
use crate::parse::service_to_db::addresses_from_message;
use crate::{contacts, messages, parse};
use anyhow::Context;
use models_email::email::db::address::UpsertedRecipients;
use models_email::email::service::thread;
use sqlx::types::Uuid;
use sqlx::{Executor, PgPool, Postgres};
use std::collections::HashMap;

/// inserts a thread and all of its messages into the database
#[tracing::instrument(
    skip(pool, service_thread),
    fields(
        thread_provider_id = %service_thread.provider_id.clone().unwrap_or_default(),
        link_id = %link_id
    ),
    level = "info"
)]
pub async fn insert_thread_and_messages(
    pool: &PgPool,
    service_thread: thread::Thread,
    link_id: Uuid,
) -> anyhow::Result<()> {
    let mut recipient_map: HashMap<String, UpsertedRecipients> = HashMap::new();

    // we have to insert addresses before inserting the messages. these values are shared
    // across messages, so inserting them in the txn can cause deadlocks.
    for message in service_thread.messages.iter() {
        let addresses = addresses_from_message(message);

        let recipients =
            contacts::upsert_message::parse_and_upsert_message_contacts(pool, link_id, addresses)
                .await
                .context("Failed to insert address ids")?;

        // can't be null bc we are getting the message from gmail api directly
        recipient_map.insert(message.provider_id.clone().unwrap(), recipients);
    }

    let mut tx = pool.begin().await.context("Failed to begin transaction")?;

    let result = async {
        // Insert thread
        let thread_id = insert_thread(&mut *tx, &service_thread, link_id)
            .await
            .context("Failed to insert thread")?;

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
            .await
            .context("Failed to insert message")?;
        }

        // Now that messages have been inserted, we can set replying_to_ids of messages for threads
        // with more than one message. If a thread only has one message, we know it will have no
        // messages replying to other messages and thus no replying_to_ids.
        if service_thread.messages.len() > 1 {
            update_thread_messages_replying_to(&mut tx, thread_id, link_id)
                .await
                .context("Failed to update messages replying_to_ids")?;
        }

        Ok::<_, anyhow::Error>(())
    }
    .await;

    if let Err(err) = result {
        if let Err(rollback_err) = tx.rollback().await {
            return Err(anyhow::anyhow!(
                "Transaction failed: {} AND rollback also failed: {}",
                err,
                rollback_err
            ));
        }
        return Err(err);
    }

    tx.commit().await.context("Failed to commit transaction")?;

    Ok(())
}

/// inserts a thread object into the database using the provided transaction
#[tracing::instrument(skip(executor, service_thread))]
pub async fn insert_thread<'e, E>(
    executor: E,
    service_thread: &thread::Thread,
    link_id: Uuid,
) -> anyhow::Result<Uuid>
where
    E: Executor<'e, Database = Postgres>,
{
    let thread_id = macro_uuid::generate_uuid_v7();
    let db_thread =
        parse::service_to_db::map_service_thread_to_db(service_thread, thread_id, link_id);

    let result = sqlx::query!(
        r#"
        INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, latest_inbound_message_ts,
                             latest_outbound_message_ts, latest_non_spam_message_ts)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (link_id, provider_id) WHERE provider_id IS NOT NULL DO UPDATE
        SET
            latest_inbound_message_ts = EXCLUDED.latest_inbound_message_ts,
            updated_at = NOW()
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
        .fetch_one(executor)
        .await
        .context(format!(
            "Failed to upsert thread with provider id {} for link_id {}",
            db_thread.provider_id.unwrap_or_default(), db_thread.link_id
        ))?;

    Ok(result.id)
}

/// inserts a thread object into the database that has no metadata or rizz
#[tracing::instrument(skip(executor))]
pub async fn insert_blank_thread<'e, E>(
    executor: E,
    thread_provider_id: &str,
    link_id: Uuid,
) -> anyhow::Result<Uuid>
where
    E: Executor<'e, Database = Postgres>,
{
    let thread = thread::Thread {
        db_id: None,
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

    insert_thread(executor, &thread, link_id).await
}
