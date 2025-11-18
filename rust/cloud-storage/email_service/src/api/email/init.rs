use crate::api::ApiContext;
use crate::api::email::sync::enable::{EnableSyncError, enable_gmail_sync};
use anyhow::Context;
use axum::{
    Extension,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::response::EmptyResponse;
use model::{response::ErrorResponse, user::UserContext};
use models_email::email::service::backfill::{
    BackfillJobStatus, BackfillOperation, BackfillPubsubMessage,
};
use models_email::email::service::link::UserProvider;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Error, AsRefStr)]
pub enum InitError {
    #[error("User is already initialized")]
    AlreadyInitialized,

    #[error("Job limit exceeded")]
    TooManyJobs,

    #[error("Failed to enqueue backfill message")]
    EnqueueError,

    #[error("Enable sync error")]
    EnableSync(#[from] EnableSyncError),

    #[error("Database query error")]
    QueryError(#[from] anyhow::Error),
}

impl IntoResponse for InitError {
    fn into_response(self) -> Response {
        match self {
            InitError::EnableSync(e) => {
                // Delegate to EnableSyncError's IntoResponse
                e.into_response()
            }
            _ => {
                let status_code = match &self {
                    InitError::AlreadyInitialized => StatusCode::BAD_REQUEST,
                    InitError::TooManyJobs => StatusCode::TOO_MANY_REQUESTS,
                    InitError::EnqueueError | InitError::QueryError(_) => {
                        StatusCode::INTERNAL_SERVER_ERROR
                    }
                    InitError::EnableSync(_) => unreachable!(),
                };

                if status_code.is_server_error() {
                    tracing::error!(
                        nested_error = ?self,
                        error_type = "InitError",
                        variant = self.as_ref(),
                        "Internal server error");
                }

                (status_code, self.to_string()).into_response()
            }
        }
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct InitResponse {
    pub link_id: Uuid,
    pub backfill_job_id: Uuid,
}

/// Initialize email functionality for the user. Populates initial threads and enables inbox syncing.
#[utoipa::path(
    post,
    tag = "Init",
    path = "/email/init",
    operation_id = "init_user",
    responses(
            (status = 200, body=InitResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, gmail_token), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    gmail_token: Extension<String>,
) -> Result<Response, InitError> {
    tracing::info!(user_id = %user_context.user_id, "Init called");
    // Fetch the existing link for the user
    let existing_link = email_db_client::links::get::fetch_link_by_fusionauth_and_macro_id(
        &ctx.db,
        &user_context.fusion_user_id,
        &user_context.user_id,
        UserProvider::Gmail,
    )
    .await
    .context("Failed to fetch existing link")?;

    // Handle different cases based on the existing link's state
    match &existing_link {
        // Case 1: User already has a link
        Some(_) => Err(InitError::AlreadyInitialized),

        // Case 2 & 3: Enable sync for new users
        None => {
            let link = enable_gmail_sync(&ctx, &user_context, Some(gmail_token.as_str())).await?;

            // users can only have 3 jobs within past 24h and one backfill job per link in progress at a time
            let recent_jobs =
                email_db_client::backfill::job::get::get_recent_jobs_by_fusionauth_user_id(
                    &ctx.db,
                    &link.fusionauth_user_id,
                )
                .await
                .context("Failed to fetch jobs by macro id")?;

            if recent_jobs.len() >= 3 && !link.email_address.ends_with("@macro.com") {
                tracing::info!(user_id = %user_context.user_id, "Too many jobs error");
                email_db_client::links::delete::delete_link_by_id(&ctx.db, link.id)
                    .await
                    .context("Failed to delete link")?;

                return Err(InitError::TooManyJobs);
            }

            // create job to backfill user's inbox history
            let backfill_job = email_db_client::backfill::job::insert::create_backfill_job(
                &ctx.db,
                link.id,
                link.fusionauth_user_id.as_str(),
                None,
            )
            .await
            .context("Failed to create backfill job")?;

            let ps_message = BackfillPubsubMessage {
                link_id: link.id,
                job_id: backfill_job.id,
                backfill_operation: BackfillOperation::Init,
            };

            if let Err(e) = ctx
                .sqs_client
                .enqueue_email_backfill_message(ps_message)
                .await
            {
                // Log the error
                tracing::error!(error = ?e, backfill_id = %backfill_job.id, "Failed to enqueue backfill message");

                // Update the job status to Failed
                let db_pool = ctx.db.clone();
                let job_id = backfill_job.id;
                tokio::spawn(async move {
                    if let Err(update_err) =
                        email_db_client::backfill::job::update::update_backfill_job_status(
                            &db_pool,
                            job_id,
                            BackfillJobStatus::Failed,
                        )
                        .await
                    {
                        tracing::error!(
                            error = ?update_err,
                            backfill_id = %job_id,
                            "Failed to update backfill job status to Failed"
                        );
                    }
                });

                return Err(InitError::EnqueueError);
            }

            Ok((
                StatusCode::OK,
                Json(InitResponse {
                    link_id: link.id,
                    backfill_job_id: backfill_job.id,
                }),
            )
                .into_response())
        }
    }
}
