use crate::context::{self};
use aws_lambda_events::eventbridge::EventBridgeEvent;
use chrono::Timelike;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use macro_env::Environment;
use models_email::email::service::pubsub::{DeletionReason, LinkManagerMessage};
use rand::seq::SliceRandom;
use sqlx::types::uuid;
use sqlx::{Pool, Postgres, Type};

/// Each link delete is one cascading transaction over all of the link's mail, so the
/// backlog is drained a few links per hourly run instead of all at once.
pub const MAX_DELETES_PER_RUN: usize = 10;

/// SQS rejects per-message delays above 15 minutes.
pub const MAX_DELETE_DELAY_SECONDS: i32 = 900;

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

    if matches!(ctx.config.environment, Environment::Production) {
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
    let mut unused_links =
        fetch_unused_link_ids(&ctx.db, ctx.config.delete_unused_after_days as i32)
            .await
            .unwrap_or_else(|e| {
                tracing::error!(error=?e, "Error fetching unused links for deletion");
                Vec::new()
            });

    let mut inactive_links =
        fetch_inactive_link_ids(&ctx.db, ctx.config.delete_inactive_after_days as i32)
            .await
            .unwrap_or_else(|e| {
                tracing::error!(error=?e, "Error fetching inactive links for deletion");
                Vec::new()
            });

    let (unused_count, inactive_count) = (unused_links.len(), inactive_links.len());
    // Random picks keep links whose deletes keep failing, or are still running from the
    // previous hour, from holding the same capped slots every run.
    {
        let mut rng = rand::rng();
        unused_links.shuffle(&mut rng);
        inactive_links.shuffle(&mut rng);
    }
    let planned = plan_delete_batch(unused_links, inactive_links);

    tracing::info!(
        sending = planned.len(),
        max_per_run = MAX_DELETES_PER_RUN,
        "Sending delete notifications for {} unused and {} inactive links",
        unused_count,
        inactive_count
    );

    for planned in planned {
        let link_id = planned.link_id;
        let deletion_reason = planned.deletion_reason;
        let notif = LinkManagerMessage::DeleteLink {
            link_id,
            deletion_reason,
        };
        ctx.sqs_client
            .enqueue_link_manager_notification_with_delay(notif, planned.delay_seconds)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, link_id=%link_id, deletion_reason=deletion_reason.as_str(), "Error enqueueing delete notification for link");
            })
            .ok();
    }

    Ok(())
}

/// A delete notification scheduled for this run.
#[derive(Debug, Clone, Copy)]
pub struct PlannedDelete {
    pub link_id: uuid::Uuid,
    pub deletion_reason: DeletionReason,
    pub delay_seconds: i32,
}

/// Picks at most [`MAX_DELETES_PER_RUN`] links, alternating unused and inactive so neither
/// starves the other, and staggers their SQS delivery evenly across
/// [`MAX_DELETE_DELAY_SECONDS`]. Links left over stay eligible for the next hourly run.
pub fn plan_delete_batch(
    unused_links: Vec<uuid::Uuid>,
    inactive_links: Vec<uuid::Uuid>,
) -> Vec<PlannedDelete> {
    let mut unused = unused_links
        .into_iter()
        .map(|id| (id, DeletionReason::Unused));
    let mut inactive = inactive_links
        .into_iter()
        .map(|id| (id, DeletionReason::Inactive));
    let mut prefer_unused = true;
    let alternating = std::iter::from_fn(move || {
        let next = if prefer_unused {
            unused.next().or_else(|| inactive.next())
        } else {
            inactive.next().or_else(|| unused.next())
        };
        prefer_unused = !prefer_unused;
        next
    });

    let spacing = MAX_DELETE_DELAY_SECONDS / MAX_DELETES_PER_RUN as i32;
    alternating
        .take(MAX_DELETES_PER_RUN)
        .zip((0..).map(|slot| slot * spacing))
        .map(
            |((link_id, deletion_reason), delay_seconds)| PlannedDelete {
                link_id,
                deletion_reason,
                delay_seconds,
            },
        )
        .collect()
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
