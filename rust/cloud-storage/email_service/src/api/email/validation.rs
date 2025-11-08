use anyhow::Context;
use axum::http::StatusCode;
use models_email::service::link::Link;
use models_email::service::message::{MessageToSend, SimpleMessage};
use serde_json::json;
use sqlx::PgPool;
use strum_macros::AsRefStr;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error, AsRefStr)]
pub enum ValidationError {
    #[error("Message with id {0} not found")]
    MessageNotFound(Uuid),

    #[error("Message with id {0} has already been sent")]
    MessageAlreadySent(Uuid),

    #[error("Cannot reply to a draft")]
    CannotReplyToDraft,

    #[error("Failed to get message from database")]
    QueryError(#[from] anyhow::Error),
}

impl ValidationError {
    pub fn status_code(&self) -> StatusCode {
        match self {
            ValidationError::MessageNotFound(_) => StatusCode::NOT_FOUND,
            ValidationError::CannotReplyToDraft | ValidationError::MessageAlreadySent(_) => {
                StatusCode::BAD_REQUEST
            }
            ValidationError::QueryError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

/// Validate draft request
pub async fn validate_replying_to_id(
    db: &PgPool,
    request_message: &mut MessageToSend,
    link: &Link,
) -> Result<(), ValidationError> {
    if let Some(replying_to_id) = request_message.replying_to_id {
        // check if a draft already exists replying to this message, and if so, use its values
        if let Some(existing_draft) = get_draft_replying_to_id(db, replying_to_id, &link.id).await?
        {
            request_message.db_id = Some(existing_draft.db_id);
            request_message.thread_db_id = Some(existing_draft.thread_db_id);
            request_message.provider_thread_id = existing_draft.provider_thread_id;
            request_message.headers_json = existing_draft.headers_json;

            return Ok(());
        }

        // ensure message we are replying to exists and is not a draft
        let message_replying_to =
            validate_reply_message(db, &replying_to_id, &link.fusionauth_user_id).await?;

        // set draft thread values based on the message we're replying to
        request_message.thread_db_id = Some(message_replying_to.thread_db_id);
        request_message.provider_thread_id = message_replying_to.provider_thread_id;

        // generate macro-in-reply-to header for email based on the replying_to_id of the draft. temporary
        // solution that allows FE to determine the message the draft is replying to, until we have a
        // dedicated field in the message table for replying_to_id
        request_message.headers_json = Some(json!([{
            "Macro-In-Reply-To": message_replying_to.db_id.to_string()
        }]));
    }

    Ok(())
}

/// Ensure message db_id does not belong to an already-sent message
pub async fn validate_existing_message(
    db: &PgPool,
    fusionauth_user_id: &str,
    message_to_send: &mut MessageToSend,
) -> Result<(), ValidationError> {
    if let Some(db_id) = message_to_send.db_id {
        let db_message = email_db_client::messages::get_simple_messages::get_simple_message(
            db,
            &db_id,
            fusionauth_user_id,
        )
        .await
        .context("Failed to get message replying to")?
        .ok_or(ValidationError::MessageNotFound(db_id))?;

        if db_message.is_sent || !db_message.is_draft {
            return Err(ValidationError::MessageAlreadySent(db_id));
        }

        message_to_send.thread_db_id = Some(db_message.thread_db_id);
        // this might exist if the message being sent is part of an existing thread, or might not if
        // the message being sent is the first message in the thread
        message_to_send.provider_thread_id = db_message.provider_thread_id;
    }

    Ok(())
}

/// Ensure message we are replying to exists and is not a draft
pub async fn validate_reply_message(
    db: &PgPool,
    replying_to_id: &Uuid,
    fusionauth_user_id: &str,
) -> Result<SimpleMessage, ValidationError> {
    let message_replying_to = email_db_client::messages::get_simple_messages::get_simple_message(
        db,
        replying_to_id,
        fusionauth_user_id,
    )
    .await
    .context("Failed to get message replying to")?
    .ok_or(ValidationError::MessageNotFound(*replying_to_id))?;

    if message_replying_to.is_draft {
        return Err(ValidationError::CannotReplyToDraft);
    }

    Ok(message_replying_to)
}

/// Get the draft message that is replying to the message with the passed id.
pub async fn get_draft_replying_to_id(
    db: &PgPool,
    replying_to_id: Uuid,
    link_id: &Uuid,
) -> Result<Option<SimpleMessage>, ValidationError> {
    let existing_draft_ids =
        email_db_client::messages::get_simple_messages::get_first_simple_message_draft(
            db,
            link_id,
            replying_to_id,
        )
        .await
        .context("Failed to search for existing draft")?;
    Ok(existing_draft_ids)
}
