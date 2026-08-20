use crate::api::ApiContext;
use crate::api::context::{AuthorizationService, CalendarGrantService};
use crate::utils::extract_email_with_response;
use anyhow::Context;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use calendar_events::domain::models::{CalendarGrantIntent, GoogleScopeSet};
use email::domain::events::{EmailMacroEvent, LinkConnectedMetadata};
use email::domain::models::UserProvider;
use email::domain::ports::EmailRepo;
use email::outbound::EmailPgRepo;
use email_api_client::domain::models::{EmailApiError, TokenFreshness};
use email_service::pubsub::publish_email_event;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_db_client::in_progress_user_link::InProgressUserLink;
use macro_user_id::email::EmailStr;
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use models_email::email::service::backfill::{
    BackfillOperation, BackfillPubsubMessage, InitPayload, JobScopedPayload,
};
use models_email::service::link;
use models_email::service::link::Link;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

#[cfg(test)]
mod test;

#[derive(Debug, Error, AsRefStr)]
pub enum InitError {
    #[error("User is already initialized")]
    AlreadyInitialized,

    #[error("No Gmail grant available to provision from")]
    NoGmailGrant,

    #[error("Failed to enqueue backfill message")]
    EnqueueError,

    #[error("Database query error")]
    DatabaseError(#[from] anyhow::Error),

    #[error("Email provider operation failed")]
    ProviderError(EmailApiError),

    #[error("Bad request")]
    BadRequest(String),

    #[error("Invalid input")]
    Parse(#[from] macro_user_id::error::ParseErr),

    #[error("Inbox is already connected by another user")]
    SharedInboxConflict {
        email_address: String,
        existing_owner_email: String,
        existing_link_id: Uuid,
    },
}

/// Stable machine-readable code for [`InitError::AlreadyInitialized`].
pub const ALREADY_INITIALIZED_CODE: &str = "ALREADY_INITIALIZED";

/// Stable machine-readable code for [`InitError::NoGmailGrant`].
pub const NO_GMAIL_GRANT_CODE: &str = "NO_GMAIL_GRANT";

/// Structured 400 body carrying a machine-readable code. Clients branch on
/// `code` instead of parsing the human message.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct InitErrorCodeResponse {
    /// Stable machine-readable error code.
    pub code: String,
    /// Human-readable explanation.
    pub message: String,
}

impl InitError {
    fn status_code(&self) -> StatusCode {
        match self {
            InitError::AlreadyInitialized
            | InitError::NoGmailGrant
            | InitError::BadRequest(_)
            | InitError::Parse(_) => StatusCode::BAD_REQUEST,
            InitError::ProviderError(EmailApiError::RateLimited { .. }) => {
                StatusCode::TOO_MANY_REQUESTS
            }
            InitError::EnqueueError | InitError::DatabaseError(_) | InitError::ProviderError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
            InitError::SharedInboxConflict { .. } => StatusCode::CONFLICT,
        }
    }
}

impl IntoResponse for InitError {
    fn into_response(self) -> Response {
        let status_code = self.status_code();

        match self {
            InitError::SharedInboxConflict {
                email_address,
                existing_owner_email,
                existing_link_id,
            } => (
                status_code,
                Json(SharedInboxConflictResponse {
                    email_address,
                    existing_owner_email,
                    existing_link_id,
                }),
            )
                .into_response(),
            InitError::AlreadyInitialized => (
                status_code,
                Json(InitErrorCodeResponse {
                    code: ALREADY_INITIALIZED_CODE.to_string(),
                    message: InitError::AlreadyInitialized.to_string(),
                }),
            )
                .into_response(),
            InitError::NoGmailGrant => (
                status_code,
                Json(InitErrorCodeResponse {
                    code: NO_GMAIL_GRANT_CODE.to_string(),
                    message: InitError::NoGmailGrant.to_string(),
                }),
            )
                .into_response(),
            other => (status_code, other.to_string()).into_response(),
        }
    }
}

/// Returned with a `409 Conflict` when a connect targets an external mailbox another
/// macro user has already connected. The client surfaces a confirmation; on confirm it
/// retries `/email/init` with `force_share=true` to promote the mailbox to a shared inbox.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct SharedInboxConflictResponse {
    /// The mailbox address that is already connected.
    pub email_address: String,
    /// The email of the macro user who first connected the mailbox.
    pub existing_owner_email: String,
    /// The existing link that would be shared if the caller confirms.
    pub existing_link_id: Uuid,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct InitResponse {
    /// The email_links row id for the now-accessible inbox. For cross-user delegation
    /// this is the *existing* child link the caller now delegates over; for the
    /// self-link bootstrap and the data-source path it's a freshly upserted row.
    pub link_id: Uuid,
    /// Present when init enqueued a backfill job. Absent for cross-user delegation,
    /// where the child link's backfill already ran under its own macro_id; present for
    /// the self-link bootstrap, where a fresh link is provisioned and backfilled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backfill_job_id: Option<Uuid>,
}

#[derive(Debug, serde::Deserialize)]
pub struct InitParams {
    /// Optional link id from a `/link/gmail` flow. When set, init provisions the inbox
    /// for the email recorded on the in_progress_user_link row instead of the JWT email.
    link_id: Option<Uuid>,
    /// When set, a connect that collides with a mailbox already connected by another
    /// macro user promotes it to a shared inbox instead of returning a 409 conflict.
    #[serde(default)]
    force_share: bool,
}

/// Initialize email functionality for the user. Populates initial threads and enables inbox syncing.
#[utoipa::path(
    post,
    tag = "Init",
    path = "/email/init",
    params(
        ("link_id" = Option<Uuid>, Query, description = "**OPTIONAL**. The in_progress_user_link id from a /link/gmail flow."),
        ("force_share" = Option<bool>, Query, description = "**OPTIONAL**. Confirms promoting a mailbox already connected by another user into a shared inbox."),
    ),
    operation_id = "init_user",
    responses(
            (status = 200, body=InitResponse),
            (status = 400, body=InitErrorCodeResponse),
            (status = 401, body=ErrorResponse),
            (status = 409, body=SharedInboxConflictResponse),
            (status = 429, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    query: Query<InitParams>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, InitError> {
    // Init runs on every authentication, so its expected no-op outcomes (400s)
    // must not error-log. The span skips the auto err event and the result is
    // classified here, inside the span, where user fields still attach.
    let link_id = query.link_id;
    let db = ctx.db.clone();
    let result = init_user(ctx, query, authorization).await;
    if let Err(e) = &result {
        let status = e.status_code();
        if status.is_server_error() {
            tracing::error!(error = ?e, "init failed");
        } else {
            tracing::debug!(error = %e, "init declined");
        }
        cleanup_in_progress_link_on_failure(&db, link_id, e).await;
    }
    result
}

/// Whether a failed `/email/init` should delete its `in_progress_user_link` row. True for
/// every terminal failure except `SharedInboxConflict`, which is held open on purpose so the
/// `force_share` retry can reuse the same `link_id`.
fn should_clean_up_in_progress_link(error: &InitError) -> bool {
    !matches!(error, InitError::SharedInboxConflict { .. })
}

/// A failed `/email/init` otherwise leaves the `in_progress_user_link` row behind — only the
/// success paths delete it — where it counts toward the `/link/gmail` start cap and can lock
/// the user out of further attempts.
async fn cleanup_in_progress_link_on_failure(
    db: &sqlx::Pool<sqlx::Postgres>,
    link_id: Option<Uuid>,
    error: &InitError,
) {
    if let Some(link_id) = link_id
        && should_clean_up_in_progress_link(error)
    {
        macro_db_client::in_progress_user_link::delete_in_progress_user_link(db, &link_id)
            .await
            .inspect_err(|del_err| {
                tracing::warn!(error = ?del_err, ?link_id, "Failed to clean up in_progress_user_link after failed init");
            })
            .ok();
    }
}

async fn init_user(
    ctx: ApiContext,
    Query(InitParams {
        link_id,
        force_share,
    }): Query<InitParams>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, InitError> {
    let macro_user_id = authorization.authorization.user.macro_user_id.clone();
    let user_context = authorization.authorization.user.user_context.clone();
    let mut completed_google_grant: Option<CompletedGoogleGrant> = None;
    tracing::info!(user_id = %user_context.user_id, ?link_id, "Init called");

    let pg_repo = EmailPgRepo::new(ctx.db.clone());

    let (link, _email_address) = if let Some(link_id) = link_id {
        let in_progress =
            macro_db_client::in_progress_user_link::get_in_progress_user_link(&ctx.db, &link_id)
                .await
                .context("Failed to fetch in_progress_user_link")?;
        let completed_grant = CompletedGoogleGrant::from_in_progress(&in_progress);
        completed_google_grant = Some(completed_grant.clone());

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
            // Graph path: the linked email belongs to a different macro user. Look the
            // child's inbox up before mutating any state so the in_progress row is only
            // consumed once we know how to proceed.
            let existing_child_link = email_db_client::links::get::fetch_link_by_email(
                &ctx.db,
                &linked_email,
                link::UserProvider::Gmail,
            )
            .await
            .context("Failed to look up child link before delegation")?;

            if let Some(child_link) = existing_child_link {
                // Cross-user delegation: the child already connected their own inbox under
                // their own fusion id. Link primary (caller) → child so primary can read it.
                // Keep the in-progress grant until the calendar grant and its outbox work
                // are durable. The edge insert is idempotent if a retry reaches this path.
                let mut tx = ctx
                    .db
                    .begin()
                    .await
                    .context("Failed to begin graph delegation transaction")?;

                macro_db_client::macro_user_links::insert_edge(
                    &mut *tx,
                    &user_context.user_id,
                    child_macro_id,
                    child_link.id,
                )
                .await
                .context("Failed to insert macro_user_links edge")?;

                tx.commit()
                    .await
                    .context("Failed to commit graph delegation transaction")?;

                apply_and_consume_calendar_grant(&ctx, child_link.id, link_id, &completed_grant)
                    .await?;

                return Ok((
                    StatusCode::OK,
                    Json(InitResponse {
                        link_id: child_link.id,
                        backfill_job_id: None,
                    }),
                )
                    .into_response());
            }

            // Self-link bootstrap: the child macro_user exists but never connected an inbox.
            // Provision its email_links row entirely under the child's identity: the OAuth
            // grant (FA IdP link) is attached to the child's fusion user at the OAuth
            // callback — it is also the child's login identity, so it cannot live under the
            // primary — and token resolution, scoping, and backfill rate-limiting key off it.
            // Access for the primary comes from the macro_user_links edge alone.
            let child_macro_id_owned = MacroUserIdStr::try_from(child_macro_id.to_string())?;

            // `existing_owner` proved a User row exists for this email, so a miss here means
            // the child account vanished mid-flight. Abort rather than fall back to the
            // requester's fusion id, which would provision the link under the wrong identity.
            let child_fusion_id =
                macro_db_client::user::get::get_macro_user_id_by_email(&ctx.db, &linked_email)
                    .await
                    .context("Failed to look up child's fusion id for self-link bootstrap")?
                    .context("child macro user disappeared before self-link bootstrap")?
                    .to_string();

            let provisional_link =
                new_gmail_link(child_fusion_id, child_macro_id_owned, linked_email.clone())?;
            let subscription = ctx
                .email_api
                .register_subscription_without_cache(&provisional_link)
                .await
                .map_err(classify_provider_init_error)?;

            // The link and delegation edge commit atomically. The in-progress grant is
            // consumed only after the calendar grant and outbox work are durable.
            let mut tx = ctx
                .db
                .begin()
                .await
                .context("Failed to begin self-link bootstrap transaction")?;

            let link =
                enable_gmail_sync_for(tx.as_mut(), provisional_link, subscription.cursor.as_str())
                    .await?;

            macro_db_client::macro_user_links::insert_edge(
                &mut *tx,
                &user_context.user_id,
                child_macro_id,
                link.id,
            )
            .await
            .context("Failed to insert macro_user_links edge")?;

            tx.commit()
                .await
                .context("Failed to commit self-link bootstrap transaction")?;

            // Fall through to the shared tail so the freshly bootstrapped inbox gets its
            // initial backfill.
            (link, linked_email)
        } else {
            // Data-source path (same-user re-link or brand-new email with no prior signup).
            if let Some(existing_link) = pg_repo
                .link_by_fusionauth_email_provider(
                    &user_context.fusion_user_id,
                    &linked_email,
                    UserProvider::Gmail,
                )
                .await
                .context("Failed to check existing link by email")?
            {
                let applied = apply_and_consume_calendar_grant(
                    &ctx,
                    existing_link.id,
                    link_id,
                    &completed_grant,
                )
                .await?;
                tracing::info!(
                    link_id = %existing_link.id,
                    grant_version = applied.grant_version,
                    changed = applied.changed,
                    calendar_jobs = applied.jobs.len(),
                    "Applied Google permission upgrade to existing inbox"
                );
                return Ok((
                    StatusCode::OK,
                    Json(InitResponse {
                        link_id: existing_link.id,
                        backfill_job_id: None,
                    }),
                )
                    .into_response());
            }

            // The linked email is not itself a macro user, but another macro user may
            // already have connected this exact mailbox as a data-source link. Connecting
            // it again would store and sync a second copy of the same mailbox. Instead,
            // promote the single existing link to a shared macro user so both connectors
            // delegate over one link. Promotion turns the mailbox into a shared user, so
            // it is gated behind an explicit `force_share` confirmation.
            if existing_owner.is_none()
                && let Some(existing_link) = email_db_client::links::get::fetch_link_by_email(
                    &ctx.db,
                    &linked_email,
                    link::UserProvider::Gmail,
                )
                .await
                .context("Failed to look up existing link for shared-mailbox dedup")?
                && existing_link.macro_id.as_ref() != user_context.user_id.as_str()
            {
                if !force_share {
                    return Err(InitError::SharedInboxConflict {
                        email_address: linked_email.clone(),
                        existing_owner_email: existing_link.macro_id.email_str().to_string(),
                        existing_link_id: existing_link.id,
                    });
                }

                let organization_id =
                    macro_db_client::user::get_user_organization::get_user_organization(
                        ctx.db.clone(),
                        existing_link.macro_id.as_ref(),
                    )
                    .await
                    .context("Failed to fetch organization for shared-inbox owner")?;

                let mut tx = ctx
                    .db
                    .begin()
                    .await
                    .context("Failed to begin shared-inbox promotion transaction")?;

                let promoted = macro_db_client::shared_inbox::promote_link_to_shared(
                    &mut tx,
                    existing_link.id,
                    existing_link.macro_id.as_ref(),
                    &user_context.user_id,
                    &linked_email,
                    organization_id,
                )
                .await
                .context("Failed to promote link to shared inbox")?;

                tx.commit()
                    .await
                    .context("Failed to commit shared-inbox promotion transaction")?;

                // Relocate the mailbox's Google grant onto a dedicated FusionAuth user so the
                // inbox keeps syncing regardless of which connector stays. Done after the
                // commit: if relocation fails the inbox keeps working under the original
                // owner's grant (prior behavior) and the relocation can be retried. Once the
                // grant has moved, the link row must point at the shared user or token
                // fetches for this inbox fail, so the update is retried before giving up.
                match ctx
                    .auth_service_client
                    .relocate_inbox_grant(
                        &linked_email,
                        &existing_link.fusionauth_user_id,
                        &promoted.mailbox_fusion_id.to_string(),
                    )
                    .await
                {
                    Ok(shared_fusionauth_user_id) => {
                        const MAX_LINK_UPDATE_ATTEMPTS: u32 = 3;
                        for attempt in 1..=MAX_LINK_UPDATE_ATTEMPTS {
                            match email_db_client::links::update::update_link_fusionauth_user_id(
                                &ctx.db,
                                promoted.link_id,
                                &shared_fusionauth_user_id,
                            )
                            .await
                            {
                                Ok(()) => break,
                                Err(e) if attempt < MAX_LINK_UPDATE_ATTEMPTS => {
                                    tracing::warn!(error=?e, attempt, "Retrying link fusionauth_user_id update after grant relocation");
                                    tokio::time::sleep(std::time::Duration::from_millis(
                                        200 * u64::from(attempt),
                                    ))
                                    .await;
                                }
                                Err(e) => {
                                    tracing::error!(
                                        error=?e,
                                        link_id=%promoted.link_id,
                                        shared_fusionauth_user_id=%shared_fusionauth_user_id,
                                        "Failed to re-home link fusionauth_user_id after grant relocation; inbox token fetches will fail until the link is re-homed to the shared user"
                                    );
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!(error=?e, "Failed to relocate shared-inbox grant; inbox keeps syncing under the original owner's grant");
                    }
                }

                apply_and_consume_calendar_grant(&ctx, promoted.link_id, link_id, &completed_grant)
                    .await?;

                return Ok((
                    StatusCode::OK,
                    Json(InitResponse {
                        link_id: promoted.link_id,
                        backfill_job_id: None,
                    }),
                )
                    .into_response());
            }

            let provisional_link = new_gmail_link(
                user_context.fusion_user_id.clone(),
                macro_user_id.clone(),
                linked_email.clone(),
            )?;
            let subscription = ctx
                .email_api
                .register_subscription_without_cache(&provisional_link)
                .await
                .map_err(classify_provider_init_error)?;

            let mut tx = ctx
                .db
                .begin()
                .await
                .context("Failed to begin link transaction")?;

            let link =
                enable_gmail_sync_for(tx.as_mut(), provisional_link, subscription.cursor.as_str())
                    .await?;

            tx.commit()
                .await
                .context("Failed to commit link transaction")?;

            (link, linked_email)
        }
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

        let provisional_link = new_gmail_link(
            user_context.fusion_user_id.clone(),
            macro_user_id.clone(),
            email,
        )?;
        let subscription = ctx
            .email_api
            .register_subscription_without_cache(&provisional_link)
            .await
            .map_err(classify_provider_init_error)?;

        let mut tx = ctx
            .db
            .begin()
            .await
            .context("Failed to begin link transaction")?;

        let link =
            enable_gmail_sync_for(tx.as_mut(), provisional_link, subscription.cursor.as_str())
                .await?;
        let email = link.email_address.0.as_ref().to_string();

        tx.commit()
            .await
            .context("Failed to commit link transaction")?;

        (link, email)
    };

    if let (Some(grant), Some(link_id)) = (completed_google_grant.as_ref(), link_id) {
        apply_and_consume_calendar_grant(&ctx, link.id, link_id, grant).await?;
    } else if completed_google_grant.is_none() {
        apply_grant_discovered_from_token(&ctx, &link).await;
    }

    // Concurrent /email/init calls for the same inbox upsert the same link (ON CONFLICT)
    // and would each enqueue a backfill. Reuse an in-flight backfill if one already exists
    // for this link rather than starting a duplicate. This cheap pre-check covers the common
    // sequential case; the partial unique index behind create_backfill_job closes the
    // check-then-create race for truly concurrent callers.
    if let Some(existing) =
        email_db_client::backfill::job::get::get_active_backfill_job(&ctx.db, link.id)
            .await
            .context("Failed to check for an in-flight backfill job")?
    {
        return Ok((
            StatusCode::OK,
            Json(InitResponse {
                link_id: link.id,
                backfill_job_id: Some(existing.id),
            }),
        )
            .into_response());
    }

    let Some(backfill_job) = email_db_client::backfill::job::insert::create_backfill_job(
        &ctx.db,
        link.id,
        link.fusionauth_user_id.as_str(),
        None,
        false,
    )
    .await
    .context("Failed to create backfill job")?
    else {
        // Lost the create race: a concurrent init already started this link's backfill.
        // Reuse it without writing a duplicate history row or enqueueing a second backfill.
        let existing =
            email_db_client::backfill::job::get::get_active_backfill_job(&ctx.db, link.id)
                .await
                .context("Failed to fetch in-flight backfill job after insert conflict")?
                .context("backfill insert conflicted but no active job found")?;
        return Ok((
            StatusCode::OK,
            Json(InitResponse {
                link_id: link.id,
                backfill_job_id: Some(existing.id),
            }),
        )
            .into_response());
    };

    // Genuinely new job — record link creation in history (best-effort) only now.
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

    // Same gate as the history row above: only a genuinely new connection
    // reaches here, so re-inits and concurrent duplicates don't re-publish.
    publish_email_event(
        ctx.macro_event_broker.as_ref(),
        &EmailMacroEvent::link_connected(LinkConnectedMetadata {
            link_id: link.id,
            owner: link.macro_id.clone(),
            email_address: link.email_address.0.as_ref().to_string(),
            provider: link.provider.as_str().to_string(),
            is_primary: link.is_primary,
            connected_at: link.created_at,
        }),
    );

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

        email_db_client::backfill::job::update::fail_backfill_job(&ctx.db, backfill_job.id)
            .await
            .context("Failed to persist initial backfill publication failure")?;

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

/// Returns false when the link is missing or the lookup fails so token discovery remains
/// best-effort on the authentication path.
async fn has_unrecorded_google_grant(db: &sqlx::PgPool, link_id: Uuid) -> bool {
    sqlx::query_scalar!(
        r#"
        SELECT COALESCE(g.grant_version, 0) = 0 AS "unrecorded!"
        FROM email_links l
        LEFT JOIN email_link_google_scopes g ON g.link_id = l.id
        WHERE l.id = $1
        "#,
        link_id,
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .unwrap_or(false)
}

/// Init runs on every authentication, including first-login SSO where
/// FusionAuth performs the token exchange and the granted scopes never reach
/// the link flow. When the link has no recorded grant generation, discover
/// the scopes from Google's tokeninfo endpoint using the link's own token so
/// SSO-only users still receive calendar sync. Best-effort: a failure here
/// must never fail authentication, and the next init retries it.
async fn apply_grant_discovered_from_token(ctx: &ApiContext, link: &link::Link) {
    if !has_unrecorded_google_grant(&ctx.db, link.id).await {
        return;
    }
    let token = match ctx
        .email_api
        .get_access_token(link.id, TokenFreshness::Fresh)
        .await
    {
        Ok(token) => token,
        Err(error) => {
            tracing::warn!(error = ?error, link_id = %link.id, "skipping grant discovery: no Google token");
            return;
        }
    };
    match fetch_token_scopes(token.expose_secret()).await {
        Ok(scopes) => {
            apply_calendar_grant(
                ctx.calendar_service.as_ref(),
                link.id,
                &scopes,
                CalendarGrantIntent::Incidental,
            )
                .await
                .inspect_err(|error| {
                    tracing::warn!(error = ?error, link_id = %link.id, "failed to apply discovered Google grant");
                })
                .ok();
        }
        Err(error) => {
            tracing::warn!(error = ?error, link_id = %link.id, "failed to discover Google token scopes");
        }
    }
}

/// Ask Google which scopes an access token actually carries.
async fn fetch_token_scopes(access_token: &str) -> anyhow::Result<Vec<String>> {
    #[derive(serde::Deserialize)]
    struct TokenInfo {
        scope: String,
    }
    // One shared client with a hard timeout: discovery runs on the
    // authentication path, so a hung Google response must not stall login.
    static TOKENINFO_CLIENT: std::sync::LazyLock<reqwest::Client> =
        std::sync::LazyLock::new(|| {
            reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("static reqwest client configuration is valid")
        });
    let info: TokenInfo = TOKENINFO_CLIENT
        .post("https://www.googleapis.com/oauth2/v3/tokeninfo")
        .form(&[("access_token", access_token)])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(info
        .scope
        .split_ascii_whitespace()
        .map(ToOwned::to_owned)
        .collect())
}

/// The Google grant a completed link flow carries back, with what the consent
/// request asked for — the grant alone cannot say whether calendar scopes were
/// wanted or merely re-issued.
#[derive(Clone)]
struct CompletedGoogleGrant {
    intent: CalendarGrantIntent,
    granted_scopes: Vec<String>,
}

impl CompletedGoogleGrant {
    /// Only a consent request that asked for calendar counts as the user
    /// enabling it. Requests carry `include_granted_scopes=true`, so a plain
    /// Gmail reconnect hands calendar scopes back from an earlier grant, and
    /// that must not undo a deliberate opt-out.
    fn from_in_progress(in_progress: &InProgressUserLink) -> Self {
        let requested =
            GoogleScopeSet::from_scopes(in_progress.requested_google_scopes.iter().cloned());
        Self {
            intent: if requested.has_calendar_capability() {
                CalendarGrantIntent::CalendarRequested
            } else {
                CalendarGrantIntent::Incidental
            },
            granted_scopes: in_progress.granted_google_scopes.clone(),
        }
    }
}

async fn apply_calendar_grant(
    calendar_service: &CalendarGrantService,
    email_link_id: Uuid,
    granted_scopes: &[String],
    intent: CalendarGrantIntent,
) -> Result<calendar_events::domain::models::AppliedGoogleGrant, InitError> {
    calendar_service
        .apply_google_grant(
            email_link_id,
            GoogleScopeSet::from_scopes(granted_scopes.iter().cloned()),
            intent,
        )
        .await
        .map_err(|error| {
            InitError::DatabaseError(anyhow::anyhow!(
                "failed to apply Google grant to email link: {error:?}"
            ))
        })
}

async fn apply_and_consume_calendar_grant(
    ctx: &ApiContext,
    email_link_id: Uuid,
    in_progress_link_id: Uuid,
    grant: &CompletedGoogleGrant,
) -> Result<calendar_events::domain::models::AppliedGoogleGrant, InitError> {
    let applied = apply_calendar_grant(
        ctx.calendar_service.as_ref(),
        email_link_id,
        &grant.granted_scopes,
        grant.intent,
    )
    .await?;
    macro_db_client::in_progress_user_link::delete_in_progress_user_link(
        &ctx.db,
        &in_progress_link_id,
    )
    .await
    .context("Failed to consume applied Google grant")?;

    // Reaching here means consent completed for this inbox's mailbox and its
    // refresh token was just replaced, so any reauth flag is stale. Links
    // provisioned by this flow are upserted with the flag already clear; an
    // inbox that merely reconnected is not, and would keep asking to reconnect
    // until something happened to fetch a token. Best-effort: a stale badge is
    // a worse outcome to trade a failed reconnect for.
    email_db_client::links::update::clear_link_needs_reauth(&ctx.db, email_link_id)
        .await
        .inspect_err(|error| {
            tracing::warn!(error = ?error, link_id = %email_link_id, "failed to clear the reauth flag after a completed consent");
        })
        .ok();

    Ok(applied)
}

fn classify_provider_init_error(error: EmailApiError) -> InitError {
    match error {
        EmailApiError::AuthRequired | EmailApiError::Forbidden => {
            tracing::debug!("no usable Gmail grant for requested inbox");
            InitError::NoGmailGrant
        }
        error => InitError::ProviderError(error),
    }
}

fn new_gmail_link(
    fusion_user_id: String,
    macro_id: MacroUserIdStr<'static>,
    email_address: String,
) -> Result<Link, InitError> {
    let email_address = EmailStr::try_from(email_address)?;
    let is_primary = Link::derive_is_primary(&macro_id, &email_address);
    Ok(Link {
        id: macro_uuid::generate_uuid_v7(),
        macro_id,
        fusionauth_user_id: fusion_user_id,
        email_address,
        provider: link::UserProvider::Gmail,
        is_sync_active: true,
        is_primary,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    })
}

/// Persists a provisionally registered link and its initial provider cursor atomically.
#[tracing::instrument(skip(conn), err)]
async fn enable_gmail_sync_for(
    conn: &mut sqlx::PgConnection,
    link: Link,
    history_id: &str,
) -> Result<Link, InitError> {
    let link = email_db_client::links::insert::upsert_link(&mut *conn, link)
        .await
        .context("Failed to upsert link")?;

    email_db_client::histories::upsert_gmail_history(&mut *conn, link.id, history_id)
        .await
        .context("Failed to upsert gmail history")?;

    Ok(link)
}
