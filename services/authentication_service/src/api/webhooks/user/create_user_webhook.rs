#[cfg(test)]
mod test;

use analytics_client::{MetaActionSource, MetaUserData};
use std::{collections::HashSet, future::Future};

use anyhow::Context;
use authentication_service::service::signup_policy::SignupPolicy;
use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use rand::Rng;

use crate::{
    api::{
        context::{ApiContext, AuthorizationService},
        signup_policy::signup_forbidden_response,
    },
    rate_limit_config::RATE_LIMIT_CONFIG,
};
use authentication_service::service::user::create_user::create_user;
use authentication_service::service::user::support_channel_welcome::post_support_channel_welcome;
use channels::domain::{
    models::{ChannelType, CreateChannelRequest},
    ports::ChannelService,
};
use favorites::domain::ports::FavoritesService;
use fusionauth::error::FusionAuthClientError;
use macro_user_id::{
    email::{Email, ReadEmailParts},
    user_id::MacroUserIdStr,
};
use model::authentication::webhooks::{FusionAuthUserWebhook, User as FusionAuthWebhookUser};
use model_entity::EntityType;
use teams::domain::team_repo::TeamService;

/// Macro support team members added to every new user's support channel.
const MACRO_SUPPORT_EMAILS: [&str; 3] = ["jacob@macro.com", "julia@macro.com", "teo@macro.com"];

fn support_channel_name<T: AsRef<str>>(email: &Email<T>) -> String {
    format!("Macro Support x {}", email.local_part())
}

/// Name the identity provider gave us, as (first, last).
///
/// Google SSO fills firstName/lastName via the IdP reconcile lambda; fall back to
/// splitting fullName at the first space for providers that only send a display
/// name. Passwordless signups have none of these and yield (None, None).
fn identity_provider_name(user: &FusionAuthWebhookUser) -> (Option<String>, Option<String>) {
    fn trimmed(value: &Option<String>) -> Option<String> {
        value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    let first_name = trimmed(&user.first_name);
    let last_name = trimmed(&user.last_name);
    if first_name.is_some() || last_name.is_some() {
        return (first_name, last_name);
    }

    match trimmed(&user.full_name) {
        Some(full_name) => match full_name.split_once(' ') {
            Some((first, last)) => (
                Some(first.to_string()),
                Some(last.trim().to_string()).filter(|last| !last.is_empty()),
            ),
            None => (Some(full_name), None),
        },
        None => (None, None),
    }
}

/// FusionAuth create user webhook
#[tracing::instrument(skip(ctx, req, _internal_authorization), fields(email=%req.event.user.email, fusionauth_user_id=%req.event.user.id, username=?req.event.user.username, event_type=%req.event.event_type, ip_address=%req.event.info.ip_address))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
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
            dispatch_user_create_webhook(&ctx.signup_policy, req, |req| {
                create_user_webhook(&ctx, req)
            })
            .await
            .map_err(user_create_webhook_error_response)?;
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

enum UserCreateWebhookError {
    Forbidden,
    Onboarding(anyhow::Error),
}

fn user_create_webhook_error_response(error: UserCreateWebhookError) -> Response {
    match error {
        UserCreateWebhookError::Forbidden => signup_forbidden_response(),
        UserCreateWebhookError::Onboarding(e) => {
            tracing::error!(error=?e, "unable to user.create");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

async fn dispatch_user_create_webhook<F, Fut>(
    signup_policy: &SignupPolicy,
    req: FusionAuthUserWebhook,
    onboard_user: F,
) -> Result<(), UserCreateWebhookError>
where
    F: FnOnce(FusionAuthUserWebhook) -> Fut,
    Fut: Future<Output = anyhow::Result<()>>,
{
    signup_policy
        .authorize_public_email(&req.event.user.email)
        .map_err(|_| UserCreateWebhookError::Forbidden)?;

    onboard_user(req)
        .await
        .map_err(UserCreateWebhookError::Onboarding)
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
    let (first_name, last_name) = identity_provider_name(&req.event.user);
    let username = req.event.user.username.unwrap_or(email.clone());
    let fusionauth_user_id = req.event.user.id;

    // FusionAuth's own email validation is more permissive than ours (e.g. it allows
    // single quotes). The user.create event is transactional (AbsoluteMajority), so
    // returning an error here aborts the FusionAuth user creation entirely.
    let parsed_email = match Email::parse_from_str(&email) {
        Ok(email) => email,
        Err(e) => anyhow::bail!("email is not a valid macro email: {e}"),
    };
    let support_channel_name = support_channel_name(&parsed_email);

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

    if let Some((user_id, organization_id)) =
        macro_db_client::user::get::get_user_profile_by_fusionauth_user_id_and_email(
            &ctx.db,
            &fusionauth_user_id,
            &email,
        )
        .await?
    {
        tracing::info!(user_id=?user_id, organization_id=?organization_id, "user profile already exists for FusionAuth user");
        return Ok(());
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

    // Authoritative signup analytics: fired here so every creation path
    // (SSO, passwordless, iOS) counts exactly once, even if the user never
    // returns to the app. Meta's CompleteRegistration fires here too
    // (Conversions API) — only a minority of new accounts ever load the web
    // app with the `signed_up=true` marker, so the browser pixel alone
    // misses most signups. The browser still fires the same event with the
    // shared `signup:{user_id}` event id purely to contribute click-id
    // cookies for attribution; Meta dedupes the pair on that id (see the
    // web app's signupCompletion.ts). Uses the same distinct id
    // ("macro|{email}") the app identifies with. Fire-and-forget.
    tokio::spawn({
        let analytics_client = ctx.analytics_client.clone();
        let db = ctx.db.clone();
        let fusionauth_user_id = fusionauth_user_id.clone();
        let user_id = user_id.clone();
        let email = email.clone();
        let ip_address = ip_address.clone();
        let verified = req.event.user.verified;
        let has_organization = organization_id.is_some();
        async move {
            // Seed the profile with the name the identity provider gave us (Google
            // SSO). Keyed on the FusionAuth id, which is macro_user.id — `user_id`
            // here is the "macro|{email}" User profile id.
            if first_name.is_some() || last_name.is_some() {
                let _ = macro_db_client::user::update_user_name::update_user_name(
                    &db,
                    &fusionauth_user_id,
                    first_name,
                    last_name,
                )
                .await
                .inspect_err(
                    |e| tracing::error!(error=?e, "unable to set user name from identity provider"),
                );
            }

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

            let user_data = MetaUserData {
                email: Some(email),
                client_ip_address: Some(ip_address),
                ..Default::default()
            };
            let _ = analytics_client
                .track_meta(
                    "CompleteRegistration",
                    &user_data,
                    MetaActionSource::Website,
                    Some(&format!("signup:{user_id}")),
                    serde_json::json!({
                        // Must mirror the browser payload in the web app's
                        // signupCompletion.ts: Meta keeps whichever of the
                        // deduped pair lands first, so diverging payloads
                        // would report a value that depends on race timing.
                        // Accounts are always free at creation (value =
                        // SIGNUP_LEAD_VALUE_DEFAULT in leadValues.ts); paid
                        // value is tracked separately via the Stripe events.
                        "content_name": "account_created",
                        "content_category": "free",
                        "value": 20,
                        "currency": "USD",
                    }),
                )
                .await
                .inspect_err(|e| {
                    tracing::warn!(error=?e, "failed to track Meta CompleteRegistration");
                });
        }
    });

    // Tell Loops the account now exists. This upserts the contact into our
    // marketing audience, triggers the welcome sequence, and is the exit
    // condition for the mobile-lead nurture sequence — so a lead who converts
    // stops being asked to sign up. Fire-and-forget: a Loops failure must never
    // block user creation.
    tokio::spawn({
        let loops_client = ctx.loops_client.clone();
        let email = loops_client::normalize_email(&email);
        let user_id = user_id.clone();
        async move {
            let _ = loops_client
                .send_event(
                    &email,
                    "user_registered",
                    &serde_json::json!({
                        "signupStage": "registered",
                        "hasAccount": true,
                        "source": "macro-signup",
                    }),
                    Some(&format!("user-registered-{user_id}")),
                )
                .await
                .inspect_err(
                    |e| tracing::error!(error=?e, "failed to send Loops user_registered event"),
                );
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

    // Seed the starter documents (the "Macro how to guide" and the starter
    // tasks it links to, with the guide pinned to the new user's sidebar
    // favorites), then create a private support channel connecting the new
    // user with the Macro support team and post the welcome script — which
    // mentions the guide, so seeding runs first. Fire-and-forget: neither a
    // failed seeding (retried, then skipped) nor a failed channel creation
    // may block user creation.
    tokio::spawn({
        let document_storage_service_client = ctx.document_storage_service_client.clone();
        let channel_service = ctx.channel_service.clone();
        let favorites_service = ctx.favorites_service.clone();
        let user_id = user_id.clone();
        let email = email.clone();
        let support_channel_name = support_channel_name.clone();
        async move {
            initialize_starter_docs_with_retries(&document_storage_service_client, &user_id).await;

            let owner_id = match MacroUserIdStr::try_from(user_id) {
                Ok(owner_id) => owner_id,
                Err(e) => {
                    tracing::error!(error=?e, "unable to parse user id for support channel");
                    return;
                }
            };

            let participants = match MACRO_SUPPORT_EMAILS
                .into_iter()
                .map(MacroUserIdStr::try_from_email)
                .collect::<Result<HashSet<_>, _>>()
            {
                Ok(participants) => participants,
                Err(e) => {
                    tracing::error!(error=?e, "unable to parse support user ids for support channel");
                    return;
                }
            };

            let channel = match channel_service
                .create_system_channel(
                    owner_id.clone(),
                    CreateChannelRequest {
                        name: Some(support_channel_name),
                        channel_type: ChannelType::Private,
                        team_id: None,
                        auto_join_team: false,
                        participants,
                    },
                )
                .await
            {
                Ok(channel) => channel,
                Err(e) => {
                    tracing::error!(error=?e, %email, "failed to create Macro support channel");
                    return;
                }
            };

            let channel_entity = EntityType::Channel.with_entity_str(&channel.id);
            if let Err(e) = favorites_service
                .add_favorite_with_established_access(&owner_id, &channel_entity)
                .await
            {
                tracing::error!(error=?e, channel_id=%channel.id, %email, "failed to favorite Macro support channel");
            }

            let _ = post_support_channel_welcome(channel_service.as_ref(), &channel.id, owner_id)
                .await
                .inspect_err(|e| {
                tracing::error!(error=?e, channel_id=%channel.id, %email, "failed to post Macro support welcome message");
            });
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

/// Seed the starter documents with retries.
async fn initialize_starter_docs_with_retries(
    client: &document_storage_service_client::DocumentStorageServiceClient,
    user_id: &str,
) {
    const MAX_ATTEMPTS: u32 = 3;
    const RETRY_DELAY_SECS: u64 = 2;
    for attempt in 1..=MAX_ATTEMPTS {
        match client.initialize_starter_docs(user_id).await {
            Ok(_) => return,
            Err(e) if attempt < MAX_ATTEMPTS => {
                tracing::warn!(error=?e, attempt, "failed to initialize starter docs, retrying");
                tokio::time::sleep(std::time::Duration::from_secs(RETRY_DELAY_SECS)).await;
            }
            Err(e) => {
                tracing::error!(error=?e, "failed to initialize starter docs after {MAX_ATTEMPTS} attempts");
            }
        }
    }
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
