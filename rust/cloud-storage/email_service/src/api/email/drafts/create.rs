use crate::api::context::ApiContext;
use crate::api::email::validation::{self, ValidationError};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use email_db_client::contacts::upsert_message::parse_and_upsert_message_contacts;
use email_db_client::messages::insert::insert_message_to_send_db;
use email_db_client::parse::service_to_db::addresses_from_message;
use email_db_client::user_history::upsert_user_history;
use macro_uuid::generate_uuid_v7;
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::email::db::address::UpsertedRecipients;
use models_email::service::link::Link;
use models_email::service::{message, thread};
use sqlx::PgPool;
use sqlx::types::chrono::{DateTime, Utc};
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error, AsRefStr)]
pub enum CreateDraftError {
    #[error("Validation error: {0}")]
    Validation(#[from] ValidationError),

    #[error("Failed to insert draft")]
    InsertError(#[from] anyhow::Error),

    #[error("A database transaction error occurred")]
    TransactionError(#[from] sqlx::Error),

    #[error("Failed to decode base64 HTML body")]
    Base64DecodeError(#[from] base64::DecodeError),

    #[error("Failed to convert decoded HTML body to UTF-8")]
    Utf8Error(#[from] std::string::FromUtf8Error),
}

impl IntoResponse for CreateDraftError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            CreateDraftError::Validation(e) => e.status_code(),
            CreateDraftError::Base64DecodeError(_) | CreateDraftError::Utf8Error(_) => {
                StatusCode::BAD_REQUEST
            }
            CreateDraftError::InsertError(_) | CreateDraftError::TransactionError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        (status_code, self.to_string()).into_response()
    }
}

/// The request passed to send a message
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct CreateDraftRequest {
    pub draft: message::MessageToSend,
    pub send_time: Option<DateTime<Utc>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct CreateDraftResponse {
    pub draft: message::MessageToSend,
}

/// Create a draft.
#[utoipa::path(
    post,
    tag = "Drafts",
    path = "/email/drafts",
    operation_id = "create_draft",
    request_body = CreateDraftRequest,
    responses(
        (status = 201, body = CreateDraftResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(
    skip(ctx, user_context, request_body),
    fields(
        user_id = user_context.user_id,
        fusionauth_user_id = user_context.fusion_user_id
    ),
    err
)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
    Json(request_body): Json<CreateDraftRequest>,
) -> Result<Response, CreateDraftError> {
    // falling back to old value for backwards compatability for now.
    let send_time = request_body.send_time.or(request_body.draft.send_time);
    let draft =
        process_message_to_send(&ctx.db, &link, request_body.draft, send_time, true).await?;
    Ok((StatusCode::CREATED, Json(CreateDraftResponse { draft })).into_response())
}

pub async fn process_message_to_send(
    db: &PgPool,
    link: &Link,
    mut draft: message::MessageToSend,
    send_time: Option<DateTime<Utc>>,
    is_draft: bool,
) -> Result<message::MessageToSend, CreateDraftError> {
    // TODO: Create api layer struct that doesn't have this value
    draft.link_id = link.id;

    validation::validate_existing_message(db, &link.fusionauth_user_id, &mut draft).await?;

    validation::validate_replying_to_id(db, &mut draft, link).await?;

    let from_email = link.email_address.0.as_ref();

    // html comes in as a base64 encoded string, need to decode before inserting
    if let Some(html_body) = draft.body_html {
        let decoded_html = URL_SAFE_NO_PAD.decode(html_body.as_bytes())?;
        let decoded_html_str = String::from_utf8(decoded_html)?;

        // Store the decoded HTML back into the message
        draft.body_html = Some(decoded_html_str);
    }

    // Parse and upsert contacts before starting the transaction to avoid deadlocks.
    // Contacts are shared across messages so they must be inserted outside the transaction.
    let addresses = addresses_from_message(&draft);
    let recipients = parse_and_upsert_message_contacts(db, link.id, addresses)
        .await
        .map_err(CreateDraftError::InsertError)?;

    let mut tx = db.begin().await?;

    let result = insert_message_to_send(
        &mut tx, &mut draft, send_time, is_draft, from_email, recipients,
    )
    .await;

    match result {
        Ok(_) => {
            tx.commit().await?;
            Ok(draft)
        }
        Err(e) => {
            if let Err(rollback_err) = tx.rollback().await {
                tracing::error!(error=?rollback_err, "Failed to rollback transaction after draft insert failure");
            }
            Err(CreateDraftError::from(e))
        }
    }
}

#[tracing::instrument(skip(tx, recipients), err)]
async fn insert_message_to_send(
    tx: &mut sqlx::PgConnection,
    draft: &mut message::MessageToSend,
    send_time: Option<DateTime<Utc>>,
    is_draft: bool,
    from_email: &str,
    recipients: UpsertedRecipients,
) -> anyhow::Result<()> {
    let link_id = draft.link_id;
    let now: DateTime<Utc> = Utc::now();

    let thread_db_id = if let Some(id) = draft.thread_db_id {
        id
    } else {
        // Generate thread ID in service layer before insertion
        let thread_id = generate_uuid_v7();
        let thread = thread::Thread {
            db_id: thread_id,
            provider_id: None,
            link_id,
            // if we're creating a thread with a sent message, it's not visible in the inbox
            inbox_visible: false,
            is_read: true,
            latest_inbound_message_ts: None,
            latest_outbound_message_ts: None,
            latest_non_spam_message_ts: None,
            created_at: now,
            updated_at: now,
            messages: Vec::new(),
        };

        let new_id =
            email_db_client::threads::insert::insert_thread(&mut *tx, &thread, link_id).await?;

        draft.thread_db_id = Some(new_id);
        new_id
    };

    let from_email_id =
        email_db_client::contacts::get::fetch_id_by_email(tx, link_id, from_email).await?;

    insert_message_to_send_db(
        tx,
        draft,
        send_time,
        thread_db_id,
        from_email_id,
        is_draft,
        recipients,
    )
    .await?;

    upsert_user_history(tx, link_id, thread_db_id).await?;

    Ok(())
}
