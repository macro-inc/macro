use crate::api::ApiContext;
use crate::utils::extract_email_with_response;
use anyhow::Context;
use axum::{
    Extension,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use email::domain::models::UserProvider;
use email::domain::ports::EmailRepo;
use macro_user_id::email::EmailStr;
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use model::user::UserContext;
use model::user::axum_extractor::MacroUserExtractor;
use models_email::email::service::backfill::{
    BackfillJobStatus, BackfillOperation, BackfillPubsubMessage,
};
use models_email::service::link;
use models_email::service::link::Link;
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

    #[error("Database query error")]
    DatabaseError(#[from] anyhow::Error),

    #[error("Bad request")]
    BadRequest(String),

    #[error("Invalid input")]
    Parse(#[from] macro_user_id::error::ParseErr),
}

impl IntoResponse for InitError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            InitError::AlreadyInitialized | InitError::BadRequest(_) | InitError::Parse(_) => {
                StatusCode::BAD_REQUEST
            }
            InitError::TooManyJobs => StatusCode::TOO_MANY_REQUESTS,
            InitError::EnqueueError | InitError::DatabaseError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        (status_code, self.to_string()).into_response()
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
    MacroUserExtractor {
        macro_user_id,
        user_context,
        ..
    }: MacroUserExtractor,
    gmail_token: Extension<String>,
) -> Result<Response, InitError> {
    tracing::info!(user_id = %user_context.user_id, "Init called");
    // Fetch the existing link for the user
    let pg_repo = email::outbound::EmailPgRepo::new(ctx.db.clone());
    let existing_link = pg_repo
        .link_by_fusionauth_and_macro_id(
            &user_context.fusion_user_id,
            macro_user_id,
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

            if recent_jobs.len() >= 3 && !link.email_address.0.as_ref().ends_with("@macro.com") {
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

/// Enables Gmail sync for a user by A) registering a watch with Gmail API B) updating the link record
/// to is_sync_active = true and C) updating gmail_histories entry with the current history value.
#[tracing::instrument(skip(ctx, user_context, gmail_access_token))]
pub async fn enable_gmail_sync(
    ctx: &ApiContext,
    user_context: &UserContext,
    gmail_access_token: Option<&str>,
) -> Result<Link, InitError> {
    let token = match gmail_access_token {
        Some(token) => token.to_string(),
        None => email_service::util::gmail::auth::fetch_gmail_token_usercontext_response(
            user_context,
            &ctx.redis_client,
            &ctx.auth_service_client,
        )
        .await
        .map_err(|_| InitError::BadRequest("Failed to fetch Gmail token".to_string()))?,
    };

    // Register watch with Gmail
    let watch_response = ctx
        .gmail_client
        .register_watch(&token)
        .await
        .context("Gmail call to register watch failed")?;

    let email = extract_email_with_response(&user_context.user_id)
        .map_err(|_| InitError::BadRequest("Failed to extract email".to_string()))?;

    let mut link = link::Link {
        id: macro_uuid::generate_uuid_v7(), // will get ignored for existing links
        macro_id: MacroUserIdStr::try_from(user_context.user_id.clone())?,
        fusionauth_user_id: user_context.fusion_user_id.clone(),
        email_address: EmailStr::try_from(email)?,
        provider: models_email::service::link::UserProvider::Gmail,
        is_sync_active: true,
        created_at: Default::default(),
        updated_at: Default::default(),
    };

    // either create new link for user or update is_sync_active to true
    link = email_db_client::links::insert::upsert_link(&ctx.db, link)
        .await
        .context("Failed to upsert link")?;

    // either create gmail_histories value or update history_id to current value
    email_db_client::histories::upsert_gmail_history(&ctx.db, link.id, &watch_response.history_id)
        .await
        .context("Failed to upsert gmail history")?;

    Ok(link)
}
