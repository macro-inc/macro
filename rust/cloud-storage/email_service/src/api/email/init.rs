use crate::api::ApiContext;
use crate::utils::extract_email_with_response;
use anyhow::Context;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use email::domain::models::UserProvider;
use email::domain::ports::EmailRepo;
use email::outbound::EmailPgRepo;
use email_utils::token_cache_key::TokenCacheKey;
use macro_user_id::email::EmailStr;
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use model::user::axum_extractor::MacroUserExtractor;
use models_email::email::service::backfill::{
    BackfillJobStatus, BackfillOperation, BackfillPubsubMessage, InitPayload, JobScopedPayload,
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

    #[error("Gmail API error")]
    GmailError(#[from] models_email::gmail::error::GmailError),

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
            InitError::EnqueueError | InitError::DatabaseError(_) | InitError::GmailError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        (status_code, self.to_string()).into_response()
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct InitResponse {
    /// The email_links row id for the now-accessible inbox. For the graph path
    /// (cross-account add) this is the *existing* child link the caller now
    /// delegates over; for the data-source path it's a freshly upserted row.
    pub link_id: Uuid,
    /// Present when init enqueued a backfill job. Absent for the graph path,
    /// where the child link's backfill already ran under its own macro_id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backfill_job_id: Option<Uuid>,
}

#[derive(Debug, serde::Deserialize)]
pub struct InitParams {
    /// Optional link id from a `/link/gmail` flow. When set, init provisions the inbox
    /// for the email recorded on the in_progress_user_link row instead of the JWT email.
    link_id: Option<Uuid>,
}

/// Initialize email functionality for the user. Populates initial threads and enables inbox syncing.
#[utoipa::path(
    post,
    tag = "Init",
    path = "/email/init",
    params(
        ("link_id" = Option<Uuid>, Query, description = "**OPTIONAL**. The in_progress_user_link id from a /link/gmail flow."),
    ),
    operation_id = "init_user",
    responses(
            (status = 200, body=InitResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_extractor), fields(user_id=user_extractor.user_context.user_id, fusionauth_user_id=user_extractor.user_context.fusion_user_id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Query(InitParams { link_id }): Query<InitParams>,
    user_extractor: MacroUserExtractor,
) -> Result<Response, InitError> {
    let MacroUserExtractor {
        macro_user_id,
        user_context,
        ..
    } = user_extractor;
    tracing::info!(user_id = %user_context.user_id, ?link_id, "Init called");

    let pg_repo = EmailPgRepo::new(ctx.db.clone());

    let (link, email_address) = if let Some(link_id) = link_id {
        let in_progress =
            macro_db_client::in_progress_user_link::get_in_progress_user_link(&ctx.db, &link_id)
                .await
                .context("Failed to fetch in_progress_user_link")?;

        if in_progress.macro_user_id.to_string() != user_context.fusion_user_id {
            return Err(InitError::BadRequest(
                "link_id does not belong to the requesting user".to_string(),
            ));
        }

        let linked_email = in_progress.linked_email.ok_or_else(|| {
            InitError::BadRequest("link has not completed authentication yet".to_string())
        })?;

        // Dispatch on whether the linked email already belongs to another macro user.
        // Same-user → fall through to the data-source path. Cross-user → add a graph
        // edge instead of creating a duplicate email_links row.
        //
        // Distinguish "no user with this email" (Ok(None)) from a transient DB error
        // (Err) — collapsing the latter to None would silently fall through to the
        // data-source upsert path and create a duplicate email_links row.
        let existing_owner =
            match macro_db_client::user::get::get_user_id_by_email(ctx.db.clone(), &linked_email)
                .await
            {
                Ok(macro_id) => Some(macro_id),
                Err(sqlx::Error::RowNotFound) => None,
                Err(e) => {
                    return Err(InitError::DatabaseError(
                        anyhow::Error::from(e)
                            .context("Failed to look up existing macro user by linked_email"),
                    ));
                }
            };

        if let Some(child_macro_id) = existing_owner.as_deref()
            && child_macro_id != user_context.user_id
        {
            // Graph path: link primary (caller) → child so primary can read child's inbox.
            macro_db_client::macro_user_links::insert_edge(
                &ctx.db,
                &user_context.user_id,
                child_macro_id,
            )
            .await
            .context("Failed to insert macro_user_links edge")?;

            macro_db_client::in_progress_user_link::delete_in_progress_user_link(&ctx.db, &link_id)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, ?link_id, "Failed to delete in_progress_user_link after graph delegation");
                })
                .ok();

            let child_link = email_db_client::links::get::fetch_link_by_email(
                &ctx.db,
                &linked_email,
                link::UserProvider::Gmail,
            )
            .await
            .context("Failed to look up child link after delegation")?
            .ok_or_else(|| {
                InitError::BadRequest(
                    "child macro user exists but has no email_links row".to_string(),
                )
            })?;

            return Ok((
                StatusCode::OK,
                Json(InitResponse {
                    link_id: child_link.id,
                    backfill_job_id: None,
                }),
            )
                .into_response());
        }

        // Data-source path (same-user re-link or brand-new email with no prior signup).
        if pg_repo
            .link_by_fusionauth_email_provider(
                &user_context.fusion_user_id,
                &linked_email,
                UserProvider::Gmail,
            )
            .await
            .context("Failed to check existing link by email")?
            .is_some()
        {
            return Err(InitError::AlreadyInitialized);
        }

        let gmail_token =
            fetch_gmail_token_for_email(&ctx, &user_context.fusion_user_id, &linked_email).await?;

        let link = enable_gmail_sync_for(
            &ctx,
            &user_context.fusion_user_id,
            macro_user_id.clone(),
            &linked_email,
            &gmail_token,
        )
        .await?;

        macro_db_client::in_progress_user_link::delete_in_progress_user_link(&ctx.db, &link_id)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, ?link_id, "Failed to delete in_progress_user_link after init");
            })
            .ok();

        (link, linked_email)
    } else {
        let existing_link = pg_repo
            .link_by_fusionauth_and_macro_id(
                &user_context.fusion_user_id,
                macro_user_id.clone(),
                UserProvider::Gmail,
            )
            .await
            .context("Failed to fetch existing link")?;

        if existing_link.is_some() {
            return Err(InitError::AlreadyInitialized);
        }

        let email = extract_email_with_response(&user_context.user_id)
            .map_err(|_| InitError::BadRequest("Failed to extract email".to_string()))?;

        let gmail_token = email_service::util::gmail::auth::fetch_gmail_token_no_cache(
            &user_context,
            &ctx.redis_client,
            &ctx.auth_service_client,
        )
        .await
        .map_err(|_| InitError::BadRequest("Failed to fetch Gmail token".to_string()))?;

        let link = enable_gmail_sync_for(
            &ctx,
            &user_context.fusion_user_id,
            macro_user_id.clone(),
            &email,
            &gmail_token,
        )
        .await?;

        (link, email)
    };

    // users can only have 3 jobs within past 24h and one backfill job per link in progress at a time
    let recent_jobs = email_db_client::backfill::job::get::get_recent_jobs_by_fusionauth_user_id(
        &ctx.db,
        &link.fusionauth_user_id,
    )
    .await
    .context("Failed to fetch jobs by macro id")?;

    if recent_jobs.len() >= 3 && !email_address.ends_with("@macro.com") {
        tracing::info!(user_id = %user_context.user_id, "Too many jobs error");
        email_db_client::links::delete::delete_link_by_id(&ctx.db, link.id)
            .await
            .context("Failed to delete link")?;

        return Err(InitError::TooManyJobs);
    }

    // Record link creation in history table for tracking (best-effort)
    email_db_client::links_history::insert::insert_email_link_history(
        &ctx.db,
        link.id,
        &link.fusionauth_user_id,
        link.email_address.0.as_ref(),
        link.provider,
    )
    .await
    .inspect_err(|e| {
        tracing::error!(error=?e, link_id=?link.id, "Failed to insert email link history");
    })
    .ok();

    let backfill_job = email_db_client::backfill::job::insert::create_backfill_job(
        &ctx.db,
        link.id,
        link.fusionauth_user_id.as_str(),
        None,
    )
    .await
    .context("Failed to create backfill job")?;

    let ps_message = BackfillPubsubMessage {
        backfill_operation: BackfillOperation::Init(JobScopedPayload {
            link_id: link.id,
            job_id: backfill_job.id,
            payload: InitPayload {},
        }),
    };

    if let Err(e) = ctx
        .sqs_client
        .enqueue_email_backfill_message(ps_message)
        .await
    {
        tracing::error!(error = ?e, backfill_id = %backfill_job.id, "Failed to enqueue backfill message");

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
            backfill_job_id: Some(backfill_job.id),
        }),
    )
        .into_response())
}

/// Fetches a Gmail access token scoped to a specific linked email. Use this instead
/// of going through the `UserContext`-keyed path when the target inbox is not the
/// JWT subject's primary email.
async fn fetch_gmail_token_for_email(
    ctx: &ApiContext,
    fusion_user_id: &str,
    linked_email: &str,
) -> Result<String, InitError> {
    let key = TokenCacheKey::new(fusion_user_id, linked_email, UserProvider::Gmail.as_str());

    let conn = ctx
        .redis_client
        .inner
        .get_multiplexed_async_connection()
        .await
        .context("unable to connect to redis")?;

    email::outbound::fetch_gmail_access_token_no_cache(&key, &conn, &ctx.auth_service_client)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to fetch gmail token for linked email");
            InitError::BadRequest("Failed to fetch Gmail token for linked email".to_string())
        })
}

/// Registers a Gmail watch, upserts the `email_links` row, and seeds the gmail history entry.
/// Caller-provided identifiers let this serve both the JWT-driven new-user signup and the
/// `link_id`-driven add-inbox flow.
#[tracing::instrument(skip(ctx, gmail_token), err)]
async fn enable_gmail_sync_for(
    ctx: &ApiContext,
    fusion_user_id: &str,
    macro_id: MacroUserIdStr<'static>,
    email_address: &str,
    gmail_token: &str,
) -> Result<Link, InitError> {
    let watch_response = ctx.gmail_client.register_watch(gmail_token).await?;

    let link = link::Link {
        id: macro_uuid::generate_uuid_v7(),
        macro_id,
        fusionauth_user_id: fusion_user_id.to_string(),
        email_address: EmailStr::try_from(email_address.to_string())?,
        provider: link::UserProvider::Gmail,
        is_sync_active: true,
        created_at: Default::default(),
        updated_at: Default::default(),
    };

    let link = email_db_client::links::insert::upsert_link(&ctx.db, link)
        .await
        .context("Failed to upsert link")?;

    email_db_client::histories::upsert_gmail_history(&ctx.db, link.id, &watch_response.history_id)
        .await
        .context("Failed to upsert gmail history")?;

    Ok(link)
}
