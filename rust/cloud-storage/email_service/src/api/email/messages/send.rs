use crate::api::context::ApiContext;
use crate::api::email::validation::{self, ValidationError};
use crate::util::gmail::send;
use anyhow::Context;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use email_db_client::messages::insert::insert_message_to_send;
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::email::service::address::ContactInfo;
use models_email::email::service::{message, thread};
use models_email::service::link::Link;
use sqlx::types::chrono::{DateTime, Utc};
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error, AsRefStr)]
pub enum SendMessageError {
    #[error("Validation error: {0}")]
    Validation(#[from] ValidationError),

    #[error("Sender contact not found")]
    SenderContactNotFound,

    #[error("Failed to decode base64 HTML body")]
    Base64DecodeError(#[from] base64::DecodeError),

    #[error("Failed to convert decoded HTML body to UTF-8")]
    Utf8Error(#[from] std::string::FromUtf8Error),

    #[error("Failed to send message via Gmail")]
    GmailSendError(#[from] anyhow::Error),

    #[error("A database transaction error occurred")]
    TransactionError(#[from] sqlx::Error),
}

impl IntoResponse for SendMessageError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            SendMessageError::Validation(e) => e.status_code(),
            SendMessageError::SenderContactNotFound => StatusCode::INTERNAL_SERVER_ERROR,
            SendMessageError::Base64DecodeError(_) | SendMessageError::Utf8Error(_) => {
                StatusCode::BAD_REQUEST
            }
            SendMessageError::GmailSendError(_) | SendMessageError::TransactionError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        if status_code.is_server_error() {
            tracing::error!(
                nested_error = ?self,
                error_type = "SendMessageError",
                variant = self.as_ref(),
                "Internal server error");
        }

        (status_code, self.to_string()).into_response()
    }
}

/// The request passed to send a message
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct SendMessageRequest {
    pub message: message::MessageToSend,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct SendMessageResponse {
    pub message: message::MessageToSend,
}

/// Send an email message.
#[utoipa::path(
    post,
    tag = "Messages",
    path = "/email/messages",
    operation_id = "send_message",
    request_body = SendMessageRequest,

    responses(
            (status = 201, body=SendMessageResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, gmail_token, request_body), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn send_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    gmail_token: Extension<String>,
    link: Extension<Link>,
    Json(request_body): Json<SendMessageRequest>,
) -> Result<Response, SendMessageError> {
    let mut message_to_send = request_body.message;
    // TODO: Make api-layer struct that doesn't have this or provider ids
    message_to_send.link_id = link.id;

    validation::validate_existing_message(&ctx.db, &link.fusionauth_user_id, &mut message_to_send)
        .await?;

    validation::validate_replying_to_id(&ctx.db, &mut message_to_send, &link).await?;

    let sender_contact = email_db_client::contacts::get::fetch_contact_by_email(
        &ctx.db,
        link.id,
        link.email_address.0.as_ref(),
    )
    .await?
    .ok_or(SendMessageError::SenderContactNotFound)?;

    let from_contact = ContactInfo {
        email: link.email_address.0.as_ref().to_string(),
        name: sender_contact.name,
        photo_url: sender_contact.photo_url,
    };

    // Generate email headers that are used for threading
    let (parent_message_id, references) =
        send::generate_email_threading_headers(&ctx.db, message_to_send.replying_to_id, link.id)
            .await;

    // html comes in as a base64 encoded string, need to decode before inserting
    if let Some(html_body) = message_to_send.body_html {
        let decoded_html = URL_SAFE_NO_PAD.decode(html_body.as_bytes())?;
        let decoded_html_str = String::from_utf8(decoded_html)?;

        // Store the decoded HTML back into the message
        message_to_send.body_html = Some(decoded_html_str);
    }

    // if we are creating a new thread, we need to have a ts for the message in the db less than
    // the actual sent time. this is so the value gets updated in the webhook when gmail sends us the
    // processed message post-send
    let before_send_ts = Utc::now();

    ctx.gmail_client
        .send_message(
            gmail_token.as_str(),
            &mut message_to_send,
            &from_contact,
            parent_message_id,
            references,
        )
        .await?;

    let mut tx = ctx.db.begin().await?;

    let result =
        insert_sent_message(&mut tx, &mut message_to_send, from_contact, before_send_ts).await;

    match result {
        Ok(_) => {
            tx.commit().await?;
            Ok((
                StatusCode::CREATED,
                Json(SendMessageResponse {
                    message: message_to_send,
                }),
            )
                .into_response())
        }
        Err(e) => {
            if let Err(rollback_err) = tx.rollback().await {
                tracing::error!(error=?rollback_err, provider_id=?message_to_send.provider_id, "Failed to rollback transaction after sent message insert failure");
            }
            Err(SendMessageError::from(e))
        }
    }
}

async fn insert_sent_message(
    tx: &mut sqlx::PgConnection,
    message_to_send: &mut message::MessageToSend,
    from_contact: ContactInfo,
    before_send_ts: DateTime<Utc>,
) -> anyhow::Result<()> {
    let mut thread_db_id = message_to_send.thread_db_id;
    let thread_provider_id = message_to_send.provider_thread_id.clone();
    let now: DateTime<Utc> = Utc::now();
    let link_id = message_to_send.link_id;

    // if there isn't already a thread associated with this message, create one
    match thread_db_id {
        None => {
            let thread = thread::Thread {
                db_id: None,
                provider_id: Some(thread_provider_id.clone().unwrap()), // safe bc it always gets populated in gmail_client
                link_id,
                // if we're creating a thread with a sent message, it's not visible in the inbox
                inbox_visible: true,
                is_read: true,
                latest_inbound_message_ts: None,
                latest_outbound_message_ts: Some(before_send_ts),
                latest_non_spam_message_ts: Some(before_send_ts),
                created_at: now,
                updated_at: now,
                messages: Vec::new(),
            };

            thread_db_id = Option::from(
                email_db_client::threads::insert::insert_thread(&mut *tx, &thread, link_id)
                    .await
                    .context("unable to insert thread")?,
            );
            message_to_send.thread_db_id = thread_db_id;
        }
        Some(thread_db_id) => {
            // need to upsert the thread's provider_id in case it doesn't exist already (e.g. if we are
            // sending a previously existing draft that is the first message in the thread)
            email_db_client::threads::update::update_thread_provider_id(
                tx,
                thread_db_id,
                link_id,
                &thread_provider_id.clone().unwrap(),
            )
            .await
            .context(format!(
                "Failed to update provider id to {} for thread {}",
                thread_provider_id.clone().unwrap(),
                thread_db_id
            ))?;
        }
    }

    let from_email_id =
        // safe because we always populate the from field before calling this function
        email_db_client::contacts::get::fetch_id_by_email(tx, link_id, from_contact.email.as_str())
            .await.context("unable to fetch from email id")?;

    insert_message_to_send(
        tx,
        message_to_send,
        thread_db_id.unwrap(),
        from_email_id,
        false,
    )
    .await
    .context("unable to insert message to send")?;

    Ok(())
}
