use crate::messages;
use crate::messages::get;
use anyhow::Context;
use models_email::service::message;
use sqlx::types::Uuid;
use std::collections::HashMap;

/// Updates a single message's replying_to_id field
#[tracing::instrument(skip(executor), level = "info")]
pub async fn update_db_message_replying_to_id<'e, E>(
    executor: E,
    link_id: Uuid,
    message_id: Uuid,
    replying_to_id: Option<Uuid>,
) -> anyhow::Result<bool>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let result = sqlx::query!(
        r#"
        UPDATE email_messages
        SET
            replying_to_id = $1,
            updated_at = NOW()
        WHERE
            id = $2
            AND link_id = $3
        RETURNING id
        "#,
        replying_to_id,
        message_id,
        link_id
    )
    .fetch_optional(executor)
    .await
    .with_context(|| {
        format!(
            "Failed to update replying_to_id for message {} for link_id {}",
            message_id, link_id
        )
    })?;

    // Return true if a message was updated, false otherwise
    let updated = result.is_some();

    if !updated {
        tracing::warn!(
            message_id = %message_id,
            link_id = %link_id,
            "No message was updated - message may not exist or doesn't belong to the link"
        );
    }

    Ok(updated)
}

/// Updates the replying_to_id for multiple messages belonging to a single link (typically part
/// of the same thread)
#[tracing::instrument(skip(executor), level = "info")]
pub async fn update_db_messages_replying_to_ids<'e, E>(
    executor: E,
    link_id: Uuid,
    updates: &[(Uuid, Uuid)],
) -> anyhow::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    if updates.is_empty() {
        return Ok(());
    }

    let (message_ids, replying_to_ids): (Vec<Uuid>, Vec<Uuid>) = updates.iter().cloned().unzip();

    let result = sqlx::query!(
        r#"
        UPDATE email_messages
        SET
            replying_to_id = update_data.new_replying_to_id,
            updated_at = NOW()
        FROM
            UNNEST($1::uuid[], $2::uuid[])
                AS update_data(message_id, new_replying_to_id)
        WHERE
            email_messages.id = update_data.message_id
            AND email_messages.link_id = $3
        "#,
        &message_ids,
        &replying_to_ids,
        link_id
    )
    .execute(executor)
    .await
    .with_context(|| {
        format!(
            "Failed to bulk update replying_to_id for {} messages for link_id {}",
            updates.len(),
            link_id
        )
    })?;

    let rows_affected = result.rows_affected();

    if rows_affected < updates.len() as u64 {
        tracing::warn!(
            link_id = %link_id,
            expected_updates = updates.len(),
            actual_updates = rows_affected,
            "Fewer messages were updated than expected. Some messages may not exist or do not belong to the link."
        );
    }

    Ok(())
}

/// Update the replying_to_id field of a message based on its In-Reply-To header. This can only be done
/// after all existing messages in the message's thread have been inserted, else the message the passed
/// message is replying to may not exist in the database yet.
#[tracing::instrument(skip(tx, message), level = "info")]
pub async fn update_message_replying_to_from_headers(
    tx: &mut sqlx::PgConnection,
    message: &message::Message,
    message_db_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<()> {
    if let Some(headers) = &message.headers_json
        && let Some(in_reply_to) = extract_in_reply_to(headers)
    {
        let db_id_replying_to = get::get_message_id_by_global_id(&mut *tx, link_id, &in_reply_to)
            .await
            .with_context(|| {
                format!(
                    "Failed to get message id for global id {} for link id {}",
                    in_reply_to, link_id,
                )
            })?;

        // doesn't always exist, because forwarded emails can have In-Reply-To referring to
        // the email that was forwarded, which may or may not exist in db
        if let Some(db_id_replying_to) = db_id_replying_to {
            // Update the message's replying_to_id field
            update_db_message_replying_to_id(tx, link_id, message_db_id, Some(db_id_replying_to))
                .await
                .with_context(|| {
                    format!(
                        "Failed to update replying_to_id for message {} to {}",
                        message_db_id, db_id_replying_to
                    )
                })?;

            tracing::debug!(
                message_id = %message_db_id,
                replying_to_id = %db_id_replying_to,
                "Updated message replying_to_id"
            );
        }
    }

    Ok(())
}

/// Update the replying_to_id field of a message in a thread based on its In-Reply-To header. This can only be done
/// after all existing messages in the message's thread have been inserted, else the message a message
/// is replying to may not exist in the database yet.
#[tracing::instrument(skip(tx), level = "info")]
pub async fn update_thread_messages_replying_to(
    tx: &mut sqlx::PgConnection,
    thread_db_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<()> {
    let simple_messages = messages::get_simple_messages::get_simple_messages_for_thread(
        &mut *tx,
        thread_db_id,
        link_id,
    )
    .await
    .with_context(|| {
        format!(
            "Failed to get simple messages for thread id {} for link id {}",
            thread_db_id, link_id
        )
    })?;

    // if there is only one message in the thread, we know it isn't replying to anything
    if simple_messages.len() == 1 {
        return Ok(());
    }

    // create map of key global_id, value db_id for quick retrieval of db_ids
    let mut global_db_map: HashMap<String, Uuid> = HashMap::new();
    for message in &simple_messages {
        global_db_map.insert(message.global_id.clone(), message.db_id);
    }

    let mut replying_to_id_tuples: Vec<(Uuid, Uuid)> = Vec::new();

    // if message has In-Reply-To header, get db_id of message with that global_id and add to list for insertion
    for message in simple_messages {
        if let Some(headers) = &message.headers_json
            && let Some(in_reply_to) = extract_in_reply_to(headers)
        {
            // doesn't always exist, because forwarded emails can have In-Reply-To referring to
            // the email that was forwarded,y which may or may not exist in db
            if let Some(db_id_replying_to) = global_db_map.get(&in_reply_to) {
                replying_to_id_tuples.push((message.db_id, *db_id_replying_to));
            }
        }
    }

    // set replying_to_ids in database
    update_db_messages_replying_to_ids(tx, link_id, &replying_to_id_tuples).await?;

    Ok(())
}

/// Extracts the In-Reply-To value from the headers_json
fn extract_in_reply_to(headers_json: &serde_json::Value) -> Option<String> {
    // Check if headers_json is an array
    if let Some(headers) = headers_json.as_array() {
        // Iterate through each header object
        for header in headers {
            // Get the name field
            if let Some(name) = header.get("name").and_then(|n| n.as_str()) {
                // Check if the name is "In-Reply-To" (case sensitive)
                if name == "In-Reply-To" {
                    // Return the value
                    return header
                        .get("value")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }
        }
    }
    None
}
