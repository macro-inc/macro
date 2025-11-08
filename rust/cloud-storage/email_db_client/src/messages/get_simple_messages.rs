use crate::parse::db_to_service::map_db_message_to_simple_message;
use anyhow::Context;
use models_email::db;
use models_email::service::message;
use sqlx::types::Uuid;
use sqlx::{Executor, PgPool, Postgres};

// Attempts to fetch each message in the provided list of provider IDs, returning None for messages that do not exist.
pub async fn get_simple_messages(
    pool: &PgPool,
    provider_ids: Vec<String>,
    link_id: Uuid,
) -> anyhow::Result<Vec<message::SimpleMessage>> {
    let mut results = Vec::new();

    for provider_id in provider_ids {
        if let Some(message) =
            get_simple_message_by_provider_and_link(pool, &provider_id, &link_id).await?
        {
            results.push(message);
        }
    }

    Ok(results)
}

/// retrieve a simplified version of message that has no nested fields (contacts, labels, attachments). Direct
/// map from the db::message::Message object, with no body attributes. returns None if no message was found.
pub async fn get_simple_message_by_provider_and_link(
    pool: &PgPool,
    provider_id: &str,
    link_id: &Uuid,
) -> anyhow::Result<Option<message::SimpleMessage>> {
    // Fetch message without body-related attributes
    let db_message = sqlx::query_as!(
        db::message::Message,
        r#"
        SELECT
            m.id, m.provider_id, m.global_id, m.link_id, m.thread_id, m.provider_thread_id, m.replying_to_id, 
            m.provider_history_id, m.internal_date_ts, m.snippet, m.size_estimate, m.subject,
            m.from_contact_id, m.sent_at, m.has_attachments, m.is_read, m.is_starred, m.is_sent, m.is_draft,
            NULL::TEXT as body_text,
            NULL::TEXT as body_html_sanitized,
            NULL::TEXT as body_macro,
            m.headers_jsonb, m.created_at, m.updated_at
        FROM email_messages m
        WHERE m.provider_id = $1 AND m.link_id = $2
        "#,
        provider_id,
        link_id
    )
        .fetch_optional(pool)
        .await
        .with_context(|| {
            format!(
                "Failed to fetch message with provider_id {} and link_id {}",
                provider_id, link_id
            )
        })?;

    if let Some(db_message) = db_message {
        let simple_message = map_db_message_to_simple_message(db_message);
        Ok(Some(simple_message))
    } else {
        Ok(None)
    }
}

/// retrieve a simplified version of message that has no nested fields (contacts, labels, attachments). Direct
/// map from the db::message::Message object, with no body attributes. returns None if no message was found.
pub async fn get_simple_message(
    pool: &PgPool,
    message_id: &Uuid,
    fusionauth_user_id: &str,
) -> anyhow::Result<Option<message::SimpleMessage>> {
    // Fetch message without body-related attributes
    let db_message = sqlx::query_as!(
        db::message::Message,
        r#"
        SELECT
            m.id, m.provider_id, m.global_id, m.link_id, m.thread_id, m.provider_thread_id, m.replying_to_id,
            m.provider_history_id, m.internal_date_ts, m.snippet, m.size_estimate, m.subject,
            m.from_contact_id, m.sent_at, m.has_attachments, m.is_read, m.is_starred, m.is_sent, m.is_draft,
            NULL::TEXT as body_text,
            NULL::TEXT as body_html_sanitized,
            NULL::TEXT as body_macro,
            m.headers_jsonb, m.created_at, m.updated_at
        FROM email_messages m
        JOIN email_links l ON m.link_id = l.id
        WHERE m.id = $1 AND l.fusionauth_user_id = $2
        "#,
        message_id,
        fusionauth_user_id
    )
        .fetch_optional(pool)
        .await
        .with_context(|| {
            format!(
                "Failed to fetch message {} for user {}",
                message_id, fusionauth_user_id
            )
        })?;

    if let Some(db_message) = db_message {
        let simple_message = map_db_message_to_simple_message(db_message);
        Ok(Some(simple_message))
    } else {
        Ok(None)
    }
}

/// Returns a vector of SimpleMessage objects for all found messages
#[tracing::instrument(skip(pool), level = "info")]
pub async fn get_simple_messages_batch(
    pool: &PgPool,
    message_ids: &Vec<Uuid>,
    fusionauth_user_id: &str,
) -> anyhow::Result<Vec<message::SimpleMessage>> {
    if message_ids.is_empty() {
        return Ok(Vec::new());
    }

    let db_messages = sqlx::query_as!(
        db::message::Message,
        r#"
        SELECT
            m.id, m.provider_id, m.global_id, m.link_id, m.thread_id, m.provider_thread_id, m.replying_to_id,
            m.provider_history_id, m.internal_date_ts, m.snippet, m.size_estimate, m.subject,
            m.from_contact_id, m.sent_at, m.has_attachments, m.is_read, m.is_starred, m.is_sent, m.is_draft,
            NULL::TEXT as body_text,
            NULL::TEXT as body_html_sanitized,
            NULL::TEXT as body_macro,
            m.headers_jsonb, m.created_at, m.updated_at
        FROM email_messages m
        JOIN email_links l ON m.link_id = l.id
        WHERE m.id = ANY($1) AND l.fusionauth_user_id = $2
        "#,
        &message_ids,
        fusionauth_user_id
    )
        .fetch_all(pool)
        .await
        .with_context(|| {
            format!(
                "Failed to fetch {} messages for user {}",
                message_ids.len(), fusionauth_user_id
            )
        })?;

    let simple_messages: Vec<message::SimpleMessage> = db_messages
        .into_iter()
        .map(map_db_message_to_simple_message)
        .collect();

    Ok(simple_messages)
}

// returns SimpleMessage objects for each message in the passed thread. ordered by date desc nulls last
#[tracing::instrument(skip(executor), level = "info")]
pub async fn get_simple_messages_for_thread<'e, E>(
    executor: E,
    thread_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<Vec<message::SimpleMessage>>
where
    E: Executor<'e, Database = Postgres>,
{
    let db_messages = sqlx::query_as!(
        db::message::Message,
        r#"
        SELECT
            m.id,
            m.provider_id,
            m.global_id,
            m.link_id,
            m.thread_id,
            m.provider_thread_id,
            m.replying_to_id,
            m.provider_history_id,
            m.internal_date_ts,
            m.snippet,
            m.size_estimate,
            m.subject,
            m.from_contact_id,
            m.sent_at,
            m.has_attachments,
            m.is_read,
            m.is_starred,
            m.is_sent,
            m.is_draft,
            NULL::TEXT as body_text,
            NULL::TEXT as body_html_sanitized,
            NULL::TEXT as body_macro,
            m.headers_jsonb,
            m.created_at,
            m.updated_at
        FROM
            email_messages m
        WHERE
            m.thread_id = $1 AND m.link_id = $2
        ORDER BY
            m.internal_date_ts DESC NULLS LAST
        "#,
        thread_id,
        link_id
    )
    .fetch_all(executor)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch simple messages for thread {} and link {}",
            thread_id, link_id
        )
    })?;

    let simple_messages: Vec<message::SimpleMessage> = db_messages
        .into_iter()
        .map(map_db_message_to_simple_message)
        .collect();

    Ok(simple_messages)
}

/// Returns the first simple message draft that matches a specific "Macro-In-Reply-To" header value
/// Returns None if no matching message is found
#[tracing::instrument(skip(pool), level = "debug")]
pub async fn get_first_simple_message_draft(
    pool: &PgPool,
    link_id: &Uuid,
    replying_to_id: Uuid,
) -> anyhow::Result<Option<message::SimpleMessage>> {
    let db_message = sqlx::query_as!(
        db::message::Message,
        r#"
        SELECT
            m.id, m.provider_id, m.global_id, m.link_id, m.thread_id, m.provider_thread_id, m.provider_history_id,
            m.replying_to_id, m.internal_date_ts, m.snippet, m.size_estimate, m.subject,
            m.from_contact_id, m.sent_at, m.has_attachments, m.is_read, m.is_starred, m.is_sent, m.is_draft,
            NULL::TEXT as body_text,
            NULL::TEXT as body_html_sanitized,
            NULL::TEXT as body_macro,
            m.headers_jsonb, m.created_at, m.updated_at
        FROM email_messages m
        WHERE m.link_id = $1
          AND m.is_draft = true
          AND jsonb_path_exists(
              m.headers_jsonb,
              '$[*] ? (@."Macro-In-Reply-To" == $macro_uuid)'::jsonpath,
              jsonb_build_object('macro_uuid', $2::text)
          )
        ORDER BY m.created_at DESC
        LIMIT 1
        "#,
        link_id,
        replying_to_id.to_string()
    )
        .fetch_optional(pool)
        .await
        .with_context(|| {
            format!(
                "Failed to fetch draft message with Macro-In-Reply-To {} for link_id {}",
                replying_to_id, link_id
            )
        })?;

    Ok(db_message.map(map_db_message_to_simple_message))
}
