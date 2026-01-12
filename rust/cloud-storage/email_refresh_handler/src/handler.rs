use crate::context::{self};
use aws_lambda_events::eventbridge::EventBridgeEvent;
use chrono::Timelike;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use models_email::email::service::pubsub::LinkManagerMessage;
use models_email::service::pubsub::LinkManagerOperation;
use sqlx::Type;

#[derive(Type, Debug, Clone, Copy)]
#[sqlx(type_name = "email_user_provider_enum", rename_all = "UPPERCASE")]
pub enum DbUserProvider {
    Gmail,
}

#[tracing::instrument(skip(ctx, _event))]
pub async fn handler(
    ctx: context::Context,
    _event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    let current_hour = chrono::Utc::now().hour() as i32;
    let provider_filter = DbUserProvider::Gmail;

    // uses the index idx_links_active_provider_hash_bucket
    let link_ids = sqlx::query_scalar!(
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

    if !link_ids.is_empty() {
        tracing::info!(
            "Hour {}. Sending refresh notifications for users with link_ids: {}",
            current_hour,
            link_ids
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<String>>()
                .join(", ")
        );

        for link_id in link_ids {
            let notif = LinkManagerMessage {
                link_id,
                operation: LinkManagerOperation::Refresh,
            };
            ctx.sqs_client
                .enqueue_link_manager_notification(notif)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, link_id=%link_id, "Error enqueueing refresh notification for link");
                })
                .ok();
        }
    }

    Ok(())
}
