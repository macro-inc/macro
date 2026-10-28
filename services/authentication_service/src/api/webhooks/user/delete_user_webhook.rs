use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use comms_db_client::{
    channels::get_channels::get_org_channels,
    participants::remove_participant::{RemoveParticipantOptions, remove_participant},
};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use macro_user_id::user_id::MacroUserIdStr;
use model::{authentication::webhooks::FusionAuthUserWebhook, user::UserInfo};
use notification::domain::ports::NotificationRepository;
use notification::outbound::repository::DbNotificationRepository;
use sqlx::{Pool, Postgres};
use tracing::Instrument;

use crate::api::context::{ApiContext, AuthorizationService};
use sqs_client::email::LinkManagerMessage;

/// Delete user webhook
#[tracing::instrument(
    skip(ctx, req, _internal_authorization),
    fields(
        event_id = %req.event.id,
        event_type = %req.event.event_type,
        email = %req.event.user.email,
        fusionauth_user_id = %req.event.user.id,
    )
)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Json(req): extract::Json<FusionAuthUserWebhook>,
) -> Result<Response, Response> {
    tracing::info!("received FusionAuth delete user webhook");
    let start_time = std::time::Instant::now();
    let fusionauth_user_id = req.event.user.id;

    // if fusionauth_user_id is part of an account_merge_request, return early as we are in
    // the process of merging the accounts
    if macro_db_client::account_merge_request::check_merge_request_for_to_merge_macro_user_id(
        &ctx.db,
        &fusionauth_user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to check for an account merge request");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
    })?
    .is_some()
    {
        tracing::info!(
            "account merge request exists, skipping deletion since we will handle merging accounts"
        );
        return Ok(StatusCode::OK.into_response());
    }

    let macro_user = match macro_db_client::macro_user::get_macro_user(&ctx.db, &fusionauth_user_id)
        .await
    {
        Ok(user) => user,
        // A retry after the final delete has nothing left to clean up.
        Err(error)
            if matches!(
                error.downcast_ref::<sqlx::Error>(),
                Some(sqlx::Error::RowNotFound)
            ) =>
        {
            tracing::info!(
                "macro user not found; nothing left to delete (already deleted or retried after completion)"
            );
            return Ok(StatusCode::OK.into_response());
        }
        Err(error) => {
            tracing::error!(error=?error, "unable to get macro user");
            return Err(StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    };

    let user_ids: Vec<String> =
        macro_db_client::user::get::get_user_profiles_by_fusionauth_user_id(
            &ctx.db,
            &fusionauth_user_id,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get user profiles for FusionAuth user");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        })?;

    // Await the durable cleanup so FusionAuth can retry failures. Acknowledging
    // before cleanup would strand resources if a service is unavailable.
    delete_user(ctx, macro_user, fusionauth_user_id, user_ids)
        .await
        .map_err(|error| {
            tracing::error!(error=?error, "unable to complete user deletion; FusionAuth will retry");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        })?;

    tracing::info!(
        elapsed_ms = start_time.elapsed().as_millis() as u64,
        "completed FusionAuth delete user webhook"
    );

    Ok(StatusCode::OK.into_response())
}

#[tracing::instrument(
    skip(ctx, macro_user, fusionauth_user_id, user_ids),
    fields(
        fusionauth_user_id = %fusionauth_user_id,
        stripe_customer_id = ?macro_user.stripe_customer_id,
        user_ids = ?user_ids,
        profile_count = user_ids.len(),
    ),
    err
)]
async fn delete_user(
    ctx: ApiContext,
    macro_user: macro_db_client::macro_user::MacroUser,
    fusionauth_user_id: String,
    user_ids: Vec<String>,
) -> anyhow::Result<()> {
    tracing::info!("deleting user");

    // Enqueue email link deletion via the link manager queue
    tokio::spawn({
        let sqs_client = ctx.sqs_client.clone();
        let fusionauth_user_id = fusionauth_user_id.clone();
        async move {
            let message = LinkManagerMessage::DeleteUser {
                fusionauth_user_id: fusionauth_user_id.clone(),
            };
            match sqs_client.enqueue_link_manager_notification(message).await {
                Ok(_) => tracing::info!("enqueued email link deletion"),
                Err(e) => {
                    tracing::error!(error=?e, "unable to enqueue email link deletion");
                }
            }
        }
        .in_current_span()
    });

    tokio::spawn({
        let user_ids = user_ids.clone();
        let sqs_client = ctx.sqs_client.clone();
        async move {
            for user_id in user_ids {
                match sqs_client
                    .send_message_to_search_event_queue(
                        sqs_client::search::SearchQueueMessage::RemoveUserProfile(
                            user_id.clone(),
                        ),
                    )
                    .await
                {
                    Ok(_) => {
                        tracing::info!(user_id, "enqueued user profile removal from search");
                    }
                    Err(e) => {
                        tracing::error!(error=?e, user_id, "unable to send delete user message to search event queue");
                    }
                }
            }
        }
        .in_current_span()
    });

    // `user_ids` are `User.id` profile ids (`macro|<email>`), so look them up by
    // id rather than by the email column.
    let user_info_futures = user_ids
        .clone()
        .into_iter()
        .map(|user_id| {
            let db = ctx.db.clone();
            async move {
                let result = macro_db_client::user::get::get_user_profile(&db, &user_id).await;
                (user_id, result)
            }
        })
        .collect::<Vec<_>>();

    // Await all futures concurrently
    let user_info_results = futures::future::join_all(user_info_futures).await;

    // Lookups are best-effort: a profile whose info cannot be loaded still has
    // its durable data deleted below, but skips the cache/channel/notification
    // cleanup, so record which ones were skipped.
    let user_infos: Vec<UserInfo> = user_info_results
        .into_iter()
        .filter_map(|(user_id, result)| {
            result
                .inspect_err(|e| {
                    tracing::error!(error=?e, user_id, "unable to load user info; skipping channel and notification cleanup for this profile");
                })
                .ok()
        })
        .collect();
    tracing::info!(
        loaded_profile_count = user_infos.len(),
        "loaded user info for profiles"
    );

    // MacroCache deletion
    tokio::spawn(
        {
            let redis_client = ctx.macro_cache_client.clone();
            let user_ids = user_ids.clone();
            async move {
                for user_id in user_ids {
                    match redis_client.delete_user(&user_id).await {
                        Ok(_) => tracing::info!(user_id, "deleted user session from cache"),
                        Err(e) => {
                            tracing::error!(error=?e, user_id, "unable to delete user from redis");
                        }
                    }
                }
            }
        }
        .in_current_span(),
    );

    // Remove user from organization channels
    tokio::spawn(
        {
            let db = ctx.db.clone();
            let user_infos = user_infos.clone();
            async move {
                for user_info in user_infos {
                    let user_id = user_info.id.clone();
                    // TODO: create delete user endpoint in comms service and handle removing this user and
                    // deleting all of their channels. Keep the messages for now.
                    let Some(org_id) = user_info.organization_id else {
                        tracing::info!(user_id, "user has no organization; no organization channels to leave");
                        continue;
                    };
                    match remove_user_from_org_channels(&db, &user_id, org_id as i64).await {
                        Ok(channel_count) => {
                            tracing::info!(user_id, organization_id = org_id, channel_count, "removed user from organization channels");
                        }
                        Err(err) => {
                            tracing::error!(error=?err, user_id, organization_id = org_id, "unable to remove user from org channels");
                        }
                    }
                }
            }
        }
        .in_current_span(),
    );

    // Delete user notifications directly from the database
    // TODO: technically we should be calling into the notification service here
    // but since the service method would just be a straight passthrough to the repo, this is simpler than plumbing the entire service down
    tokio::spawn(
        {
            let user_infos = user_infos.clone();
            let notification_repo = DbNotificationRepository::new(ctx.db.clone());
            async move {
                for user_info in user_infos {
                    let user_id = user_info.id.clone();
                    match MacroUserIdStr::parse_from_str(&user_id) {
                        Ok(macro_user_id) => {
                            match notification_repo
                                .delete_all_user_notifications(macro_user_id)
                                .await
                            {
                                Ok(_) => tracing::info!(user_id, "deleted user notifications"),
                                Err(e) => {
                                    tracing::error!(error=?e, user_id, "unable to delete user notifications");
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!(error=?e, user_id, "unable to parse user id for notification cleanup");
                        }
                    }
                }
            }
        }
        .in_current_span(),
    );

    // Use the authoritative profile ids, not the best-effort user-info lookups.
    let users = user_ids
        .iter()
        .map(|id| MacroUserIdStr::try_from(id.clone()))
        .collect::<Result<Vec<_>, _>>()?;
    let start_time = std::time::Instant::now();
    crate::service::user::delete_user::delete_user_data(
        ctx.user_deletion.as_ref(),
        &macro_user.id,
        &users,
    )
    .await
    .map_err(|error| anyhow::anyhow!("{error:?}"))?;
    tracing::info!(
        elapsed_ms = start_time.elapsed().as_millis() as u64,
        "deleted user data, profiles, billing customer, and account"
    );

    Ok(())
}

/// Removes a user from all organization channels.
///
/// Returns the number of organization channels the user was removed from.
async fn remove_user_from_org_channels(
    db: &Pool<Postgres>,
    user_id: &str,
    org_id: i64,
) -> anyhow::Result<usize> {
    let org_channels = get_org_channels(db, &org_id).await?;

    for channel in org_channels.iter() {
        remove_participant(
            db,
            RemoveParticipantOptions {
                channel_id: &channel.id,
                user_id,
            },
        )
        .await?;
    }

    Ok(org_channels.len())
}
