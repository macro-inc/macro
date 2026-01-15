use crate::api::context::ApiContext;
use crate::api::email::validation::{self, ValidationError};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use email_db_client::contacts::upsert_message::parse_and_upsert_message_contacts;
use email_db_client::messages::insert::insert_message_to_send;
use email_db_client::parse::service_to_db::addresses_from_message;
use email_db_client::user_history::upsert_user_history;
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::email::db::address::UpsertedRecipients;
use models_email::service::link::Link;
use models_email::service::{message, thread};
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
}

impl IntoResponse for CreateDraftError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            CreateDraftError::Validation(e) => e.status_code(),
            CreateDraftError::InsertError(_) | CreateDraftError::TransactionError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        if status_code.is_server_error() {
            tracing::error!(
                nested_error = ?self,
                error_type = "CreateDraftError",
                variant = self.as_ref(),
                "Internal server error");
        }

        (status_code, self.to_string()).into_response()
    }
}

/// The request passed to send a message
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct CreateDraftRequest {
    pub draft: message::MessageToSend,
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
    )
)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
    Json(request_body): Json<CreateDraftRequest>,
) -> Result<Response, CreateDraftError> {
    let mut draft = request_body.draft;
    // TODO: Create api layer struct that doesn't have this value
    draft.link_id = link.id;

    validation::validate_existing_message(&ctx.db, &link.fusionauth_user_id, &mut draft).await?;

    validation::validate_replying_to_id(&ctx.db, &mut draft, &link).await?;

    let from_email = link.email_address.0.as_ref();

    // Parse and upsert contacts before starting the transaction to avoid deadlocks.
    // Contacts are shared across messages so they must be inserted outside the transaction.
    let addresses = addresses_from_message(&draft);
    let recipients = parse_and_upsert_message_contacts(&ctx.db, link.id, addresses)
        .await
        .map_err(CreateDraftError::InsertError)?;

    let mut tx = ctx.db.begin().await?;

    let result = insert_draft(&mut tx, &mut draft, from_email, recipients).await;

    match result {
        Ok(_) => {
            tx.commit().await?;
            Ok((StatusCode::CREATED, Json(CreateDraftResponse { draft })).into_response())
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
async fn insert_draft(
    tx: &mut sqlx::PgConnection,
    draft: &mut message::MessageToSend,
    from_email: &str,
    recipients: UpsertedRecipients,
) -> anyhow::Result<()> {
    let link_id = draft.link_id;
    let now: DateTime<Utc> = Utc::now();

    let thread_db_id = if let Some(id) = draft.thread_db_id {
        id
    } else {
        let thread = thread::Thread {
            db_id: None,
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

    insert_message_to_send(tx, draft, thread_db_id, from_email_id, true, recipients).await?;

    upsert_user_history(tx, link_id, thread_db_id).await?;

    Ok(())
}
