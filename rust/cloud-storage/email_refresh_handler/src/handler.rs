use crate::context::{self};
use aws_lambda_events::eventbridge::EventBridgeEvent;
use chrono::Timelike;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use macro_env::Environment;
use models_email::email::service::pubsub::{DeletionReason, LinkManagerMessage};
use sqlx::types::uuid;
use sqlx::{Pool, Postgres, Type};

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
    tokio::try_join!(
        send_refresh_messages(&ctx),
        send_health_check_messages(&ctx)
    )?;

    // only send delete messages once daily, during the night
    if matches!(ctx.config.environment, Environment::Production) && chrono::Utc::now().hour() == 5 {
        send_delete_messages(&ctx).await?;
    }

    Ok(())
}

/// send health-check notifications for active links, bucketed by id hash so each link is
/// probed once per configured interval across the hourly runs
async fn send_health_check_messages(ctx: &context::Context) -> Result<(), Error> {
    let interval_hours = ctx.config.health_poll_interval_hours as i32;
    if interval_hours <= 0 {
        return Ok(());
    }

    let now = chrono::Utc::now();
    let current_hour = now.hour();
    // Bucket on hours since the epoch rather than hour-of-day, so every bucket stays
    // reachable even when the interval exceeds 24 hours.
    let bucket = (now.timestamp().div_euclid(3600) % i64::from(interval_hours)) as i32;
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
            AND (abs(hashtext(id::text)::bigint) % $2::int4) = $3::int4
        "#,
        provider_filter as _,
        interval_hours,
        bucket
    )
    .fetch_all(&ctx.db)
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = ?e, "Error fetching links for health check");
        Vec::new()
    });

    if !link_ids.is_empty() {
        tracing::info!(
            "Hour {}. Sending health-check notifications for {} links (every {}h)",
            current_hour,
            link_ids.len(),
            interval_hours
        );

        for link_id in link_ids {
            let notif = LinkManagerMessage::HealthCheck { link_id };
            ctx.sqs_client
                .enqueue_link_manager_notification(notif)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, link_id=%link_id, "Error enqueueing health-check notification for link");
                })
                .ok();
        }
    }
    Ok(())
}

/// send refresh notifications for active links
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
        tracing::error!(error = ?e, "Error fetching links for refresh");
        Vec::new()
    });

    if !link_ids.is_empty() {
        tracing::info!(
            "Hour {}. Sending refresh notifications for {} links",
            current_hour,
            link_ids.len()
        );

        for link_id in link_ids {
            let notif = LinkManagerMessage::Refresh { link_id };
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

/// delete unused and inactive links from our database
async fn send_delete_messages(ctx: &context::Context) -> Result<(), Error> {
    let unused_links = fetch_unused_link_ids(&ctx.db, ctx.config.delete_unused_after_days as i32)
        .await
        .unwrap_or_else(|e| {
            tracing::error!(error=?e, "Error fetching unused links for deletion");
            Vec::new()
        });

    let inactive_links =
        fetch_inactive_link_ids(&ctx.db, ctx.config.delete_inactive_after_days as i32)
            .await
            .unwrap_or_else(|e| {
                tracing::error!(error=?e, "Error fetching inactive links for deletion");
                Vec::new()
            });

    tracing::info!(
        "Sending delete notifications for {} unused and {} inactive links",
        unused_links.len(),
        inactive_links.len()
    );

    for link_id in unused_links {
        let notif = LinkManagerMessage::DeleteLink {
            link_id,
            deletion_reason: DeletionReason::Unused,
        };
        ctx.sqs_client
            .enqueue_link_manager_notification(notif)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, link_id=%link_id, "Error enqueueing delete notification for unused link");
            })
            .ok();
    }

    for link_id in inactive_links {
        let notif = LinkManagerMessage::DeleteLink {
            link_id,
            deletion_reason: DeletionReason::Inactive,
        };
        ctx.sqs_client
            .enqueue_link_manager_notification(notif)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, link_id=%link_id, "Error enqueueing delete notification for inactive link");
            })
            .ok();
    }

    Ok(())
}

/// Fetch link IDs that were created > X days ago and have never viewed a thread
pub async fn fetch_unused_link_ids(
    pool: &Pool<Postgres>,
    delete_unused_after_days: i32,
) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
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
            "#,
        delete_unused_after_days
    )
    .fetch_all(pool)
    .await
}

/// Fetch link IDs where the latest thread viewed was > Y days ago
pub async fn fetch_inactive_link_ids(
    pool: &Pool<Postgres>,
    delete_inactive_after_days: i32,
) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
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
                MAX(h.updated_at) < NOW() - (make_interval(days => $1))
            "#,
        delete_inactive_after_days
    )
    .fetch_all(pool)
    .await
}
