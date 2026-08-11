use crate::api::ApiContext;
use crate::api::context::{AuthorizationService, CalendarGrantService};
use crate::utils::extract_email_with_response;
use anyhow::Context;
use authentication_service_client::error::AuthServiceClientError;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use calendar_events::domain::models::GoogleScopeSet;
use email::domain::events::{EmailMacroEvent, LinkConnectedMetadata};
use email::domain::models::UserProvider;
use email::domain::ports::EmailRepo;
use email::outbound::EmailPgRepo;
use email_service::pubsub::publish_email_event;
use email_utils::token_cache_key::TokenCacheKey;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_user_id::email::EmailStr;
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use models_email::email::service::backfill::{
    BackfillOperation, BackfillPubsubMessage, InitPayload, JobScopedPayload,
};
use models_email::gmail::error::GmailError;
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

    #[error("Gmail API error")]
    GmailError(#[from] models_email::gmail::error::GmailError),

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
            InitError::EnqueueError | InitError::DatabaseError(_) | InitError::GmailError(_) => {
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
    let mut completed_google_grant: Option<Vec<String>> = None;
    tracing::info!(user_id = %user_context.user_id, ?link_id, "Init called");

    let pg_repo = EmailPgRepo::new(ctx.db.clone());

    let (link, _email_address) = if let Some(link_id) = link_id {
        let in_progress =
            macro_db_client::in_progress_user_link::get_in_progress_user_link(&ctx.db, &link_id)
                .await
                .context("Failed to fetch in_progress_user_link")?;
        completed_google_grant = Some(in_progress.granted_google_scopes.clone());

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

                apply_and_consume_calendar_grant(
                    &ctx,
                    child_link.id,
                    link_id,
                    &in_progress.granted_google_scopes,
                )
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

            let gmail_token =
                fetch_gmail_token_for_email(&ctx, &child_fusion_id, &linked_email).await?;
            let watch_response = register_watch_recovering(&ctx.gmail_client, &gmail_token).await?;

            // The link and delegation edge commit atomically. The in-progress grant is
            // consumed only after the calendar grant and outbox work are durable.
            let mut tx = ctx
                .db
                .begin()
                .await
                .context("Failed to begin self-link bootstrap transaction")?;

            let link = enable_gmail_sync_for(
                tx.as_mut(),
                &child_fusion_id,
                child_macro_id_owned,
                &linked_email,
                &watch_response.history_id,
            )
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
                    &in_progress.granted_google_scopes,
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

                apply_and_consume_calendar_grant(
                    &ctx,
                    promoted.link_id,
                    link_id,
                    &in_progress.granted_google_scopes,
                )
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

            let gmail_token =
                fetch_gmail_token_for_email(&ctx, &user_context.fusion_user_id, &linked_email)
                    .await?;
            let watch_response = register_watch_recovering(&ctx.gmail_client, &gmail_token).await?;

            let mut tx = ctx
                .db
                .begin()
                .await
                .context("Failed to begin link transaction")?;

            let link = enable_gmail_sync_for(
                tx.as_mut(),
                &user_context.fusion_user_id,
                macro_user_id.clone(),
                &linked_email,
                &watch_response.history_id,
            )
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

        let gmail_token =
            fetch_gmail_token_for_email(&ctx, &user_context.fusion_user_id, &email).await?;

        let watch_response = register_watch_recovering(&ctx.gmail_client, &gmail_token).await?;

        let mut tx = ctx
            .db
            .begin()
            .await
            .context("Failed to begin link transaction")?;

        let link = enable_gmail_sync_for(
            tx.as_mut(),
            &user_context.fusion_user_id,
            macro_user_id.clone(),
            &email,
            &watch_response.history_id,
        )
        .await?;

        tx.commit()
            .await
            .context("Failed to commit link transaction")?;

        (link, email)
    };

    if let (Some(scopes), Some(link_id)) = (completed_google_grant.as_deref(), link_id) {
        apply_and_consume_calendar_grant(&ctx, link.id, link_id, scopes).await?;
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
    let token = match fetch_gmail_token_for_email(
        ctx,
        &link.fusionauth_user_id,
        link.email_address.0.as_ref(),
    )
    .await
    {
        Ok(token) => token,
        Err(error) => {
            tracing::warn!(error = ?error, link_id = %link.id, "skipping grant discovery: no Google token");
            return;
        }
    };
    match fetch_token_scopes(&token).await {
        Ok(scopes) => {
            apply_calendar_grant(ctx.calendar_service.as_ref(), link.id, &scopes)
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

async fn apply_calendar_grant(
    calendar_service: &CalendarGrantService,
    email_link_id: Uuid,
    granted_scopes: &[String],
) -> Result<calendar_events::domain::models::AppliedGoogleGrant, InitError> {
    calendar_service
        .apply_google_grant(
            email_link_id,
            GoogleScopeSet::from_scopes(granted_scopes.iter().cloned()),
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
    granted_scopes: &[String],
) -> Result<calendar_events::domain::models::AppliedGoogleGrant, InitError> {
    let applied =
        apply_calendar_grant(ctx.calendar_service.as_ref(), email_link_id, granted_scopes).await?;
    macro_db_client::in_progress_user_link::delete_in_progress_user_link(
        &ctx.db,
        &in_progress_link_id,
    )
    .await
    .context("Failed to consume applied Google grant")?;
    Ok(applied)
}

/// Registers a Gmail watch, recovering from the one-watch-per-mailbox limit. A watch
/// left over from a prior connect (e.g. a disconnect that could not reach Gmail to stop
/// it) makes a fresh registration fail with 400 "Only one user push notification client
/// allowed ... call /stop then try again". On that error we stop the stale watch and
/// retry once.
async fn register_watch_recovering(
    client: &gmail_client::GmailClient,
    access_token: &str,
) -> Result<models_email::gmail::history::WatchResponse, InitError> {
    match client.register_watch(access_token).await {
        Ok(response) => Ok(response),
        Err(GmailError::Conflict(_)) => {
            tracing::warn!("Stale Gmail watch blocks registration; stopping it and retrying");
            client
                .stop_watch(access_token)
                .await
                .context("Failed to stop stale Gmail watch before retry")?;
            client
                .register_watch(access_token)
                .await
                .map_err(classify_watch_error)
        }
        Err(e) => Err(classify_watch_error(e)),
    }
}

/// Maps a watch-registration failure to its init error. Google refreshes tokens
/// regardless of granted scopes, so a grant missing the Gmail scope passes the
/// token fetch and is first rejected here with a 403 — an expected outcome
/// (scope declined at consent), logged at debug so it doesn't page.
fn classify_watch_error(e: GmailError) -> InitError {
    if matches!(e, GmailError::Forbidden) {
        tracing::debug!("gmail watch rejected for insufficient scope, no usable gmail grant");
        return InitError::NoGmailGrant;
    }
    e.into()
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
        .map_err(classify_token_fetch_error)
}

/// Maps a token-fetch failure to its init error. A 404 from the auth service
/// means no Gmail grant exists for the requested inbox — an expected outcome
/// (scope declined or grant removed), logged at debug so it doesn't page.
fn classify_token_fetch_error(e: anyhow::Error) -> InitError {
    if matches!(
        e.downcast_ref::<AuthServiceClientError>(),
        Some(AuthServiceClientError::NotFound)
    ) {
        tracing::debug!(error=?e, "no gmail grant for requested inbox");
        return InitError::NoGmailGrant;
    }
    tracing::error!(error=?e, "unable to fetch gmail token for requested inbox");
    InitError::BadRequest("Failed to fetch Gmail token".to_string())
}

/// Upserts the `email_links` row and seeds the gmail history entry for an already-registered
/// Gmail watch. Runs on a caller-provided connection so the writes can join a wider
/// transaction; callers register the watch (external IO) beforehand and pass its `history_id`.
/// Caller-provided identifiers let this serve the JWT-driven new-user signup, the
/// `link_id`-driven add-inbox flow, and the self-link bootstrap (where both `macro_id`
/// and `fusion_user_id` are the child's — the grant lives with the mailbox's own account).
#[tracing::instrument(skip(conn), err)]
async fn enable_gmail_sync_for(
    conn: &mut sqlx::PgConnection,
    fusion_user_id: &str,
    macro_id: MacroUserIdStr<'static>,
    email_address: &str,
    history_id: &str,
) -> Result<Link, InitError> {
    let email_address = EmailStr::try_from(email_address.to_string())?;
    let is_primary = link::Link::derive_is_primary(&macro_id, &email_address);
    let link = link::Link {
        id: macro_uuid::generate_uuid_v7(),
        macro_id,
        fusionauth_user_id: fusion_user_id.to_string(),
        email_address,
        provider: link::UserProvider::Gmail,
        is_sync_active: true,
        is_primary,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    };

    let link = email_db_client::links::insert::upsert_link(&mut *conn, link)
        .await
        .context("Failed to upsert link")?;

    email_db_client::histories::upsert_gmail_history(&mut *conn, link.id, history_id)
        .await
        .context("Failed to upsert gmail history")?;

    Ok(link)
}
