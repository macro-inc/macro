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
    send_refresh_messages(&ctx).await?;
    send_delete_messages(&ctx).await?;

    Ok(())
}

/// send refresh notifications for links that are active and syncing to Gmail
async fn send_refresh_messages(ctx: &context::Context) -> Result<(), Error> {
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
        tracing::error!("Error fetching links for refresh: {}", e);
        Vec::new()
    });

    if !link_ids.is_empty() {
        tracing::info!(
            "Hour {}. Sending refresh notifications for {} links",
            current_hour,
            link_ids.len()
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

/// delete inactive links from our database
async fn send_delete_messages(ctx: &context::Context) -> Result<(), Error> {
    let inactive_links = sqlx::query_scalar!(
        r#"
            -- Condition A: Created > X days ago and has NO history
            SELECT
                l.id AS "link_id!"
            FROM
                public.email_links l
            LEFT JOIN
                public.email_user_history h ON l.id = h.link_id
            WHERE
                l.macro_id NOT LIKE '%@macro.com'
                AND l.created_at < NOW() - (make_interval(days => $1))
            GROUP BY
                l.id
            HAVING
                COUNT(h.link_id) = 0

            UNION

            -- Condition B: Has history rows, but latest activity > Y days ago
            SELECT
                l.id AS "link_id!"
            FROM
                public.email_links l
            JOIN
                public.email_user_history h ON l.id = h.link_id
            WHERE
                l.macro_id NOT LIKE '%@macro.com'
            GROUP BY
                l.id
            HAVING
                MAX(h.updated_at) < NOW() - (make_interval(days => $2))
            "#,
        ctx.config.delete_unused_after_days as i32,
        ctx.config.delete_inactive_after_days as i32
    )
    .fetch_all(&ctx.db)
    .await
    .unwrap_or_else(|e| {
        tracing::error!("Error fetching inactive links for deletion: {}", e);
        Vec::new()
    });

    if !inactive_links.is_empty() {
        tracing::info!(
            "Sending delete notifications for {} inactive links",
            inactive_links.len()
        );

        for link_id in inactive_links {
            let notif = LinkManagerMessage {
                link_id,
                operation: LinkManagerOperation::Delete,
            };
            ctx.sqs_client
                .enqueue_link_manager_notification(notif)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, link_id=%link_id, "Error enqueueing delete notification for inactive link");
                })
                .ok();
        }
    }

    Ok(())
}
