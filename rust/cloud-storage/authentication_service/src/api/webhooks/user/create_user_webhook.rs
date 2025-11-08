use anyhow::Context;
use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::auth::internal_access::ValidInternalKey;
use rand::Rng;

use crate::{
    api::context::ApiContext,
    service::{fusionauth_client::error::FusionAuthClientError, user::create_user::create_user},
};
use model::authentication::webhooks::FusionAuthUserWebhook;

/// FusionAuth create user webhook
#[tracing::instrument(skip(ctx, req, _internal_access), fields(email=%req.event.user.email, fusionauth_user_id=%req.event.user.id, username=?req.event.user.username, event_type=%req.event.event_type))]
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

#[tracing::instrument(skip(ctx), fields(email=%req.event.user.email, fusionauth_user_id=%req.event.user.id, username=?req.event.user.username, event_type=%req.event.event_type))]
async fn create_user_webhook(ctx: &ApiContext, req: FusionAuthUserWebhook) -> anyhow::Result<()> {
    let email = req.event.user.email.to_lowercase();
    let username = req.event.user.username.unwrap_or(email.clone());
    let fusionauth_user_id = req.event.user.id;

    // check if user exists
    if let Ok((user_id, stripe_customer_id)) =
        macro_db_client::user::get::get_user_id_and_stripe_customer_id_by_email(&ctx.db, &email)
            .await
    {
        tracing::info!(user_id=?user_id, "user already exists");

        // There are 2 reasons why the user profile already exists:
        // 1. The user was not correctly updated to have a macro_user_id.
        // 2. The user has performed an email link to another macro account.
        // To check this, we can check if `macro_user_email_verification` exists for the email
        // and if it does and is true, we do not need to create any new rows in macrodb.
        // If not, we need to create a new macro_user and update their user profile.

        let verification_status =
            macro_db_client::macro_user_email_verification::get_macro_user_email_verification(
                &ctx.db, &email,
            )
            .await
            .context("failed to get macro user email verification")?;

        if let Some(verification_status) = verification_status {
            if !verification_status {
                anyhow::bail!("user already exists and is not verified. cannot create user");
            }

            // We do nothing here, this allows the FusionAuth user to be created which will allow
            // login through this email.

            tracing::info!("user already exists and is verified. doing nothing");
        } else {
            // Need to backfill the user due to use case 1
            tracing::warn!("user was not backfilled correctly. backfilling user");

            let stripe_customer_id = stripe_customer_id.context("expected stripe_customer_id")?;

            backfill_user(
                ctx,
                &fusionauth_user_id,
                &user_id,
                &username,
                &email,
                &stripe_customer_id,
            )
            .await
            .context("failed to backfill user")?;
        }

        return Ok(());
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

    // If the user belongs to an organization,
    // we should add them to the organization's channels
    if let Some(org_id) = organization_id {
        let comms_client = ctx.comms_client.clone();
        tracing::trace!("dispatching request to comms service to add user to org channels");
        tokio::spawn(async move {
            if let Err(err) = comms_client
                .add_user_to_org_channels(&user_id, &(org_id as i64))
                .await
            {
                tracing::error!(error=?err, "failed to call comms service client to add user to org channels");
            }
        });
    }

    tracing::trace!(email, fusionauth_user_id, elapsed=?start_time.elapsed(), "created user");

    Ok(())
}

/// Used to handle updating an existing macro user to have a macro_user record.
async fn backfill_user(
    ctx: &ApiContext,
    fusionauth_user_id: &str,
    user_id: &str,
    username: &str,
    email: &str,
    stripe_customer_id: &str,
) -> anyhow::Result<()> {
    let mut transaction = ctx.db.begin().await?;

    // ensure macro user is created
    macro_db_client::macro_user::create_macro_user(
        &mut transaction,
        fusionauth_user_id,
        username,
        stripe_customer_id,
        email,
    )
    .await?;

    // link the user to the correct fusionauth user
    macro_db_client::user::update::upsert_macro_user_id(
        &mut transaction,
        user_id,
        fusionauth_user_id,
    )
    .await?;

    // move over their user profile
    macro_db_client::user::update::migrate_macro_user_info(
        &mut transaction,
        fusionauth_user_id,
        user_id,
    )
    .await?;

    transaction.commit().await?;

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
