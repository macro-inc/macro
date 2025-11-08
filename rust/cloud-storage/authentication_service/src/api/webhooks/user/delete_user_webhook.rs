use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::auth::internal_access::ValidInternalKey;
use model::{authentication::webhooks::FusionAuthUserWebhook, user::UserInfoWithMacroUserId};
use stripe::CustomerId;
use tracing::Instrument;

use crate::api::context::ApiContext;

/// Delete user webhook
#[tracing::instrument(skip(ctx, req, _internal_access), fields(event_id=req.event.id, email=req.event.user.email,fusionauth_user_id=req.event.user.id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _internal_access: ValidInternalKey,
    extract::Json(req): extract::Json<FusionAuthUserWebhook>,
) -> Result<Response, Response> {
    tracing::info!("delete user webhook");
    let fusionauth_user_id = req.event.user.id;

    // if fusionauth_user_id is part of an account_merge_request, return early as we are in
    // the process of merging the accounts
    if macro_db_client::account_merge_request::check_merge_request_for_to_merge_macro_user_id(
        &ctx.db,
        &fusionauth_user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get merge request");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
    })?
    .is_some()
    {
        tracing::info!(
            "account merge request exists, skipping deletion since we will handle merging accounts"
        );
        return Ok(StatusCode::OK.into_response());
    }

    let macro_user = macro_db_client::macro_user::get_macro_user(&ctx.db, &fusionauth_user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get macro user");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        })?;

    let user_ids: Vec<String> =
        macro_db_client::user::get::get_user_profiles_by_fusionauth_user_id(
            &ctx.db,
            &fusionauth_user_id,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get user info by email");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        })?;

    // TODO: should probably make this into an event so we can handle service restarts
    // Spawn a single tokio task to perform the user deletion
    tokio::spawn(delete_user(ctx, macro_user, user_ids).in_current_span());

    Ok(StatusCode::OK.into_response())
}

#[tracing::instrument(skip(ctx, user_ids))]
async fn delete_user(
    ctx: ApiContext,
    macro_user: macro_db_client::macro_user::MacroUser,
    user_ids: Vec<String>,
) -> anyhow::Result<()> {
    tracing::info!("deleting user");

    tokio::spawn({
        let user_ids = user_ids.clone();
        let sqs_client = ctx.sqs_client.clone();
        async move {
            for user_id in user_ids {
                tracing::trace!(user_id, "deleting user search data");
                if let Err(e) = sqs_client
                    .send_message_to_search_event_queue(
                        sqs_client::search::SearchQueueMessage::RemoveUserProfile(user_id.clone()),
                    )
                    .await
                {
                    tracing::error!(error=?e, user_id, "unable to send delete user message to search event queue");
                }
                tracing::trace!(
                    user_id,
                    "sending delete user message to search event queue complete"
                );
            }
        }
    });

    // Handle stripe user deletion
    if let Some(stripe_customer_id) = macro_user.stripe_customer_id {
        tokio::spawn({
            let stripe_customer_id = stripe_customer_id.clone();
            let stripe_client = ctx.stripe_client.clone();
            async move {
                tracing::trace!(stripe_customer_id, "delete_stripe_customer");

                let customer_id: CustomerId = match stripe_customer_id.parse() {
                    Ok(id) => id,
                    Err(e) => {
                        tracing::error!(error=?e, stripe_customer_id, "unable to parse stripe customer id");
                        return;
                    }
                };

                if let Err(e) = stripe::Customer::delete(&stripe_client, &customer_id).await {
                    tracing::error!(error=?e, stripe_customer_id, "unable to delete stripe customer");
                }

                tracing::trace!(
                    stripe_customer_id,
                    "delete_stripe_customer complete"
                );
            }
        }.in_current_span());
    }

    // Fixed: Create futures and await them all concurrently
    let user_info_futures = user_ids
        .clone()
        .into_iter()
        .map(|user_id| {
            let db = ctx.db.clone();
            async move { macro_db_client::user::get::get_user_info_by_email(&db, &user_id).await }
        })
        .collect::<Vec<_>>();

    // Await all futures concurrently
    let user_info_results = futures::future::join_all(user_info_futures).await;

    let user_infos: Vec<UserInfoWithMacroUserId> = user_info_results
        .into_iter()
        .filter_map(|r| r.ok())
        .collect();

    // MacroCache deletion
    tokio::spawn(
        {
            let redis_client = ctx.macro_cache_client.clone();
            let user_ids = user_ids.clone();
            async move {
                for user_id in user_ids {
                    tracing::trace!(user_id, "delete_user_redis_session");
                    if let Err(e) = redis_client.delete_user(&user_id).await {
                        tracing::error!(error=?e, user_id, "unable to delete user from redis");
                    }
                    tracing::trace!(user_id, "delete_user_redis_session_complete");
                }
            }
        }
        .in_current_span(),
    );

    // Send delete user call to comms service
    tokio::spawn(
        {
            let comms_client = ctx.comms_client.clone();
            let user_infos = user_infos.clone();
            async move {
                for user_info in user_infos {
                    let user_id = user_info.id.clone();
                    tracing::trace!(user_id, "remove_user_from_org_channels",);
                    // TODO: create delete user endpoint in comms service and handle removing this user and
                    // deleting all of their channels. Keep the messages for now.
                    if let Some(org_id) = user_info.organization_id
                        && let Err(err) = comms_client
                            .remove_user_from_org_channels(&user_id, &(org_id as i64))
                            .await
                    {
                        tracing::error!(error=?err, "unable to remove user from org channels");
                    }
                    tracing::trace!(user_id, "remove_user_from_org_channels complete",);
                }
            }
        }
        .in_current_span(),
    );

    // Send delete user call to notifications
    tokio::spawn(
        {
            let user_infos = user_infos.clone();
            let notification_service_client = ctx.notification_service_client.clone();
            async move {
                for user_info in user_infos {
                    let user_id = user_info.id.clone();
                    tracing::trace!(user_id, "delete_user_notifications");
                    if let Err(e) = notification_service_client
                        .delete_user_notifications(&user_id)
                        .await
                    {
                        tracing::error!(error=?e, user_id, "unable to delete user notifications");
                    }
                    tracing::trace!(user_id, "delete_user_notifications complete");
                }
            }
        }
        .in_current_span(),
    );

    // MacroDB deletion
    tokio::spawn({
            let user_infos = user_infos.clone();
            let document_storage_service_client = ctx.document_storage_service_client.clone();
            let db = ctx.db.clone();
            let macro_user_id = macro_user.id;
            async move {
                for user_info in user_infos {
                    let user_id = user_info.id.clone();
                    tracing::trace!(user_id, "delete_document_storage_service_items");
                    if let Err(e) = document_storage_service_client
                    .delete_all_user_items(&user_id)
                    .await
                    {
                        tracing::error!(error=?e, user_id, "unable to delete user items from document storage service");
                    }
                    tracing::trace!(user_id, "delete_document_storage_service_items complete");

                    tracing::trace!(user_id, "delete_user_macro_db");
                    if let Err(e) = macro_db_client::user::delete_user::delete_user(&db, &user_id).await {
                        tracing::error!(error=?e, user_id, "delete_user_macro_db unable to delete user");
                    }
                    tracing::trace!(user_id, "delete_user_macro_db complete");

                }
                let _ = macro_db_client::macro_user::delete_macro_user(&db, &macro_user_id).await.inspect_err(|e| tracing::error!(error=?e, "unable to delete macro user"));
            }
        }.in_current_span());

    Ok(())
}
