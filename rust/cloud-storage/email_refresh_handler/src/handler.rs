use crate::context::{self};
use aws_lambda_events::eventbridge::EventBridgeEvent;
use chrono::Timelike;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use macro_env::Environment;
use models_email::email::service::pubsub::LinkManagerMessage;
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
    if matches!(ctx.config.environment, Environment::Production) {
        // only send delete messages once daily, during the night
        let current_hour = chrono::Utc::now().hour();
        if current_hour == 5 {
            tokio::try_join!(send_refresh_messages(&ctx), send_delete_messages(&ctx))?;
        } else {
            send_refresh_messages(&ctx).await?;
        }
    } else {
        send_refresh_messages(&ctx).await?;
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

/// delete inactive links from our database
async fn send_delete_messages(ctx: &context::Context) -> Result<(), Error> {
    let inactive_links = fetch_inactive_link_ids(
        &ctx.db,
        ctx.config.delete_unused_after_days as i32,
        ctx.config.delete_inactive_after_days as i32,
    )
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error=?e, "Error fetching inactive links for deletion");
        Vec::new()
    });

    if !inactive_links.is_empty() {
        tracing::info!(
            "Sending delete notifications for {} inactive links",
            inactive_links.len()
        );

        for link_id in inactive_links {
            let notif = LinkManagerMessage::DeleteLink { link_id };
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

/// Fetch link IDs that should be deleted due to inactivity
pub async fn fetch_inactive_link_ids(
    pool: &Pool<Postgres>,
    delete_unused_after_days: i32,
    delete_inactive_after_days: i32,
) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
            -- Condition A: Created > X days ago and has NO history - hasn't viewed a thread
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

            -- Condition B: Has history rows, but latest thread viewed was > Y days ago
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
        delete_unused_after_days,
        delete_inactive_after_days
    )
    .fetch_all(pool)
    .await
}
