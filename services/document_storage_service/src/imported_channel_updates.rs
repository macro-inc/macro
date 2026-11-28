//! Connect the committed import outbox to the existing Soup patch service.

use std::time::Duration;

use chrono::Utc;
use model_entity::EntityType;
use slack_integration::outbound::pg_slack_import_repo::channel_updates;
use soup_realtime::domain::{models::SoupRealtimePatch, ports::SoupRealtimeService};
use sqlx::PgPool;
use tokio::time::{MissedTickBehavior, interval};
use tokio_util::sync::CancellationToken;
use tracing::Instrument;

pub(crate) async fn run(
    pool: PgPool,
    fanout: impl SoupRealtimeService,
    shutdown: CancellationToken,
) {
    let mut poll = interval(Duration::from_secs(2));
    poll.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            biased;
            _ = shutdown.cancelled() => return,
            _ = poll.tick() => {}
        }
        loop {
            let worked = tokio::select! {
                biased;
                _ = shutdown.cancelled() => return,
                worked = publish_page(&pool, &fanout) => worked,
            };
            if !worked {
                break;
            }
        }
    }
}

async fn publish_page(pool: &PgPool, fanout: &impl SoupRealtimeService) -> bool {
    let updates = match channel_updates::claim(pool, Utc::now()).await {
        Ok(updates) => updates,
        Err(error) => {
            tracing::warn!(kind = ?error.current_context(), "failed to claim imported channel updates");
            return false;
        }
    };
    if updates.is_empty() {
        return false;
    }
    let span = tracing::info_span!(
        "slack_import.publish_channels",
        claimed = updates.len() as i64,
        published = tracing::field::Empty
    );
    async {
        let mut published = 0_i64;
        for update in updates {
            let channel = EntityType::Channel.with_entity_string(update.channel_id.to_string());
            if fanout
                .notify_users(vec![SoupRealtimePatch::for_current_channel_members(channel)])
                .await
                .is_err()
            {
                tracing::warn!("failed to publish an imported channel update");
                continue;
            }
            published += 1;
            if let Err(error) = channel_updates::acknowledge(pool, update).await {
                tracing::warn!(kind = ?error.current_context(), "failed to acknowledge an imported channel update");
            }
        }
        tracing::Span::current().record("published", published);
    }
    .instrument(span)
    .await;
    true
}
