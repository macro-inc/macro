use anyhow::Context;
use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::auth::internal_access::ValidInternalKey;
use rand::Rng;

use crate::{api::context::ApiContext, rate_limit_config::RATE_LIMIT_CONFIG};
use authentication_service::service::user::create_user::create_user;
use fusionauth::error::FusionAuthClientError;
use macro_user_id::{email::Email, user_id::MacroUserIdStr};
use model::authentication::webhooks::FusionAuthUserWebhook;
use teams::domain::team_repo::TeamService;

/// FusionAuth create user webhook
#[tracing::instrument(skip(ctx, req, _internal_access), fields(email=%req.event.user.email, fusionauth_user_id=%req.event.user.id, username=?req.event.user.username, event_type=%req.event.event_type, ip_address=%req.event.info.ip_address))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _internal_access: ValidInternalKey,
    extract::Json(req): extract::Json<FusionAuthUserWebhook>,
) -> Result<Response, Response> {
    tracing::info!("create_user_webhook");

    match req.event.event_type.as_str() {
        "user.create.complete" => {
            create_user_webhook_complete(&ctx, req).await.map_err(|e| {
                tracing::error!(error=?e, "unable to user.create.complete");
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
            })?;
        }
        "user.create" => {
            create_user_webhook(&ctx, req).await.map_err(|e| {
                tracing::error!(error=?e, "unable to user.create");
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
            })?;
        }
        "user.email.verified" => {
            verify_user_email_webhook(&ctx, req).await.map_err(|e| {
                tracing::error!(error=?e, "unable to user.email.verified");
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
            })?;
        }
        _ => {
            tracing::error!("unexpected event type");
            return Ok(StatusCode::NOT_IMPLEMENTED.into_response());
        }
    }

    Ok(StatusCode::OK.into_response())
}

#[tracing::instrument(skip(ctx, req), err)]
async fn verify_user_email_webhook(
    ctx: &ApiContext,
    req: FusionAuthUserWebhook,
) -> anyhow::Result<()> {
    let fusionauth_user_id = req.event.user.id;
    let email = req.event.user.email.to_lowercase();

    macro_db_client::macro_user_email_verification::upsert_macro_user_email_verification(
        &ctx.db,
        &fusionauth_user_id,
        &email,
        true,
    )
    .await?;

    Ok(())
}

async fn create_user_webhook_complete(
    ctx: &ApiContext,
    req: FusionAuthUserWebhook,
) -> anyhow::Result<()> {
    let fusionauth_user_id = req.event.user.id;

    match ctx.auth_client.register_user(&fusionauth_user_id).await {
        Ok(_) => Ok(()),
        Err(e) => match e {
            FusionAuthClientError::UserAlreadyRegistered => Ok(()),
            _ => {
                tracing::error!(error=?e, "unable to register user in fusionauth");
                Err(e.into())
            }
        },
    }
}

#[tracing::instrument(skip(ctx, req), err)]
async fn create_user_webhook(ctx: &ApiContext, req: FusionAuthUserWebhook) -> anyhow::Result<()> {
    let ip_address = req.event.info.ip_address;
    let email = req.event.user.email.to_lowercase();
    let username = req.event.user.username.unwrap_or(email.clone());
    let fusionauth_user_id = req.event.user.id;

    // FusionAuth's own email validation is more permissive than ours (e.g. it allows
    // single quotes). The user.create event is transactional (AbsoluteMajority), so
    // returning an error here aborts the FusionAuth user creation entirely.
    if let Err(e) = Email::parse_from_str(&email) {
        anyhow::bail!("email is not a valid macro email: {e}");
    }

    // rate limit check for user creation
    let rate_limit = ctx
        .macro_cache_client
        .get_create_user_hourly_rate_limit(&ip_address)
        .await?;

    if let Some(count) = rate_limit
        && count >= RATE_LIMIT_CONFIG.create_user_hourly.0
    {
        anyhow::bail!("rate limit exceeded")
    }

    // check if user exists
    if let Ok((user_id, _stripe_customer_id)) =
        macro_db_client::user::get::get_user_id_and_stripe_customer_id_by_email(&ctx.db, &email)
            .await
    {
        // The macro_user already exists for that email
        // We do not allow a user to login through their secondary linked account for SSO so we shouldn't allow for passwordless either
        tracing::info!(user_id=?user_id, "user already exists");

        anyhow::bail!("cannot login through secondary account link");
    }

    let start_time = std::time::Instant::now();
    let (user_id, organization_id) = create_user(
        &fusionauth_user_id,
        &username,
        &email,
        req.event.user.verified,
        &ctx.db,
        &ctx.stripe_client,
    )
    .await?;

    tracing::trace!(user_id=?user_id, organization_id=?organization_id, "created user");

    // Mark the account as freshly created so the auth callback completing this
    // flow can attribute the login as a signup (analytics). Best-effort.
    let _ = ctx
        .macro_cache_client
        .mark_user_just_signed_up(&email)
        .await
        .inspect_err(|e| tracing::error!(error=?e, "unable to mark user as just signed up"));

    // Authoritative product-analytics signup event: fired here so every
    // creation path (SSO, passwordless, iOS) counts exactly once, even if the
    // user never returns to the app. The browser fires the ad-platform
    // conversions instead — it holds the click-id cookies. Uses the same
    // distinct id ("macro|{email}") the app identifies with. Fire-and-forget.
    tokio::spawn({
        let analytics_client = ctx.analytics_client.clone();
        let user_id = user_id.clone();
        let verified = req.event.user.verified;
        let has_organization = organization_id.is_some();
        async move {
            let _ = analytics_client
                .track_posthog(
                    &user_id,
                    "sign_up",
                    serde_json::json!({
                        "verified": verified,
                        "hasOrganization": has_organization,
                    }),
                )
                .await
                .inspect_err(|e| tracing::warn!(error=?e, "failed to track PostHog sign_up event"));
        }
    });

    // Add the new sign-up to Loops (our email marketing audience / mailing
    // list). Fire-and-forget: a Loops failure must never block user creation.
    tokio::spawn({
        let loops_client = ctx.loops_client.clone();
        let email = email.clone();
        async move {
            let _ = loops_client
                .add_contact(&email, "macro-signup")
                .await
                .inspect_err(|e| tracing::warn!(error=?e, "failed to add contact to Loops"));
        }
    });

    // add user to all active experiments
    tokio::spawn({
        let db = ctx.db.clone();
        let user_id = user_id.clone();
        async move {
            if let Err(e) = initialize_user_experiments(&db, &user_id).await {
                tracing::error!(error=?e, "failed to initialize user experiments");
            }
        }
    });

    // Seed the "Macro how to guide" document and pin it to the new user's
    // sidebar favorites. Fire-and-forget with retries — signup must not fail
    // if document storage is temporarily unavailable.
    tokio::spawn({
        let document_storage_service_client = ctx.document_storage_service_client.clone();
        let user_id = user_id.clone();
        async move {
            const MAX_ATTEMPTS: u32 = 3;
            const RETRY_DELAY_SECS: u64 = 2;
            for attempt in 1..=MAX_ATTEMPTS {
                match document_storage_service_client
                    .initialize_how_to_guide(&user_id)
                    .await
                {
                    Ok(()) => return,
                    Err(e) if attempt < MAX_ATTEMPTS => {
                        tracing::warn!(error=?e, attempt, "failed to initialize how to guide, retrying");
                        tokio::time::sleep(std::time::Duration::from_secs(RETRY_DELAY_SECS)).await;
                    }
                    Err(e) => {
                        tracing::error!(error=?e, "failed to initialize how to guide after {MAX_ATTEMPTS} attempts");
                    }
                }
            }
        }
    });

    // Automatically add the new user to a team whose auto-join domain
    // matches their email domain. Fire-and-forget: a failed auto-join must
    // never block user creation.
    tokio::spawn({
        let teams_service = ctx.teams_service.clone();
        let user_id = user_id.clone();
        async move {
            let user_id = match MacroUserIdStr::parse_from_str(&user_id) {
                Ok(user_id) => user_id,
                Err(e) => {
                    tracing::error!(error=?e, "unable to parse user id for team auto-join");
                    return;
                }
            };
            match teams_service.try_join_team_by_domain(&user_id).await {
                Ok(Some(member)) => {
                    tracing::info!(team_id=%member.team_id, %user_id, "auto-joined user to team by email domain");
                }
                Ok(None) => {}
                Err(e) => {
                    tracing::error!(error=?e, %user_id, "failed to auto-join user to team by email domain");
                }
            }
        }
    });

    tracing::trace!(email, fusionauth_user_id, elapsed=?start_time.elapsed(), "created user");

    // Allow to fail silently
    let _ = ctx
        .macro_cache_client
        .increment_create_user_hourly_rate_limit(&ip_address)
        .await
        .inspect_err(|e| tracing::error!(error=?e, "unable to increment create user rate limit"));

    Ok(())
}

/// Initializes the experiments for a provided user
#[allow(dead_code)]
async fn initialize_user_experiments(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<()> {
    let active_experiments = macro_db_client::experiment::get_active_experiments(db)
        .await
        .context("failed to get active experiments")?;

    let active_experiments = active_experiments
        .into_iter()
        .map(|e| {
            let mut rng = rand::rng();
            let random_bool = rng.random_bool(0.5);
            if random_bool {
                (e.id, "A".to_string())
            } else {
                (e.id, "B".to_string())
            }
        })
        .collect::<Vec<(String, String)>>();

    macro_db_client::experiment_log::bulk_create_experiment_logs(db, user_id, &active_experiments)
        .await
        .context("failed to bulk create experiment logs")?;

    Ok(())
}
