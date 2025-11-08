use crate::context::{self};
use aws_lambda_events::eventbridge::EventBridgeEvent;
use chrono::Timelike;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use models_email::email::db::link::UserProvider;
use models_email::email::service::pubsub::RefreshMessage;

#[tracing::instrument(skip(ctx, _event))]
pub async fn handler(
    ctx: context::Context,
    _event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    let current_hour = chrono::Utc::now().hour() as i32;
    let provider_filter = UserProvider::Gmail;

    // uses the index idx_links_active_provider_hash_bucket
    let notifications = sqlx::query_as!(
        RefreshMessage,
        r#"
        SELECT
            id as "link_id"
        FROM email_links
        WHERE
            is_sync_active = TRUE
            AND provider = $1
            AND (abs(hashtext(id::text)) % 24) = $2
        "#,
        provider_filter as _,
        current_hour
    )
    .fetch_all(&ctx.db)
    .await
    .unwrap_or_else(|e| {
        tracing::error!("Error fetching notifications: {}", e);
        Vec::new()
    });

    if !notifications.is_empty() {
        tracing::info!(
            "Hour {}. Sending refresh notifications for users with link_ids: {}",
            current_hour,
            notifications
                .iter()
                .map(|n| n.link_id.to_string())
                .collect::<Vec<String>>()
                .join(", ")
        );
    }

    for notif in notifications {
        let link_id = notif.link_id;
        if let Err(e) = ctx
            .sqs_client
            .enqueue_email_refresh_notification(notif)
            .await
        {
            tracing::error!(
                "Error enqueueing refresh notification for link_id {}: {}",
                link_id,
                e
            );
        };
    }

    Ok(())
}
