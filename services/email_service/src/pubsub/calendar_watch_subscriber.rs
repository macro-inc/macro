//! Relay subscriber giving local stacks real Google Calendar push.
//!
//! When `CALENDAR_WATCH_RELAY_URL` is configured (local stacks only), this
//! worker connects OUT to the serving deployment's SSE endpoint and treats
//! each relayed notification exactly like a direct webhook delivery: verify
//! nothing (the relay already routed by this stack's own channel token) and
//! re-arm the watched inbox's sync job. The 5-minute poll remains the
//! backstop across disconnects, so every failure here degrades to today's
//! freshness instead of an error.
//!
//! On graceful shutdown the worker stops every open push channel at Google —
//! a local stack that is going away has no reason to keep deliveries flowing
//! toward the relay. Deployments never run this teardown: their channels are
//! meant to outlive any single replica.

use std::sync::Arc;
use std::time::Duration;

use authentication_service_client::AuthServiceClient;
use calendar_events::domain::service::{CalendarService, stop_all_watch_channels};
use calendar_events::outbound::google::GoogleCalendarClient;
use calendar_events::outbound::pg::PgCalendarRepository;
use futures::StreamExt;
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;

use calendar_watch_relay::{
    RelayedWatchNotification, SseDataParser, WatchRelaySubscriberConfig,
    watch_relay_subscriber_config,
};

use crate::calendar_tokens::CalendarTokenProviderAdapter;
use crate::pubsub::calendar_backfill_adapters::RedisCalendarRequestGate;
use crate::pubsub::context::calendar_watch_config;
use crate::util::redis::RedisClient;

const INITIAL_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
/// The server keep-alives every 15s, so a chunk gap this long means the
/// connection is dead even when TCP has not noticed yet.
const READ_TIMEOUT: Duration = Duration::from_secs(60);
/// Bound on the subscribe request itself: response headers must arrive
/// promptly even though the body then stays open indefinitely, so a stalled
/// server returns control to the reconnect loop instead of parking it.
const SUBSCRIBE_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Bound on the shutdown stop pass so container teardown is never hung.
const STOP_CHANNELS_TIMEOUT: Duration = Duration::from_secs(15);

/// Subscribe to relayed watch notifications until cancelled, then stop the
/// stack's open push channels. A stack without relay configuration returns
/// immediately.
pub async fn run(
    db: PgPool,
    redis_client: RedisClient,
    auth_service_client: Arc<AuthServiceClient>,
    calendar_sync_enabled: bool,
    cancellation: CancellationToken,
) {
    let Some(config) = watch_relay_subscriber_config() else {
        return;
    };
    let Some(watch) = calendar_watch_config() else {
        tracing::warn!(
            "CALENDAR_WATCH_RELAY_URL is set without a complete watch config; not subscribing"
        );
        return;
    };
    if !calendar_sync_enabled {
        tracing::warn!(
            "CALENDAR_WATCH_RELAY_URL is set but calendar sync is disabled; not subscribing"
        );
        return;
    }
    tracing::info!(url = %config.url, "subscribing to relayed calendar watch notifications");
    let calendar_service = CalendarService::new(PgCalendarRepository::new(db.clone()));
    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            tracing::error!(error = ?error, "failed to build the relay subscriber http client");
            return;
        }
    };
    let mut backoff = INITIAL_BACKOFF;
    loop {
        tokio::select! {
            () = cancellation.cancelled() => break,
            connected = subscribe_once(&client, &config, &watch.token, &calendar_service) => {
                match connected {
                    Ok(()) => {
                        backoff = INITIAL_BACKOFF;
                        tracing::info!("relay subscription ended; reconnecting");
                    }
                    Err(error) => {
                        tracing::warn!(error = ?error, delay_secs = backoff.as_secs(), "relay subscription failed; backing off");
                    }
                }
            }
        }
        tokio::select! {
            () = cancellation.cancelled() => break,
            () = tokio::time::sleep(backoff) => {}
        }
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
    stop_open_channels(db, redis_client, auth_service_client).await;
}

/// Hold one SSE subscription, dispatching every relayed notification.
/// Returns `Ok` only after a healthy stream ends, so callers can distinguish
/// connection churn from setup failures when pacing reconnects.
async fn subscribe_once(
    client: &reqwest::Client,
    config: &WatchRelaySubscriberConfig,
    token: &str,
    calendar_service: &CalendarService<PgCalendarRepository>,
) -> anyhow::Result<()> {
    let request = client
        .get(format!("{}/calendar/relay/subscribe", config.url))
        .header("x-relay-secret", &config.secret)
        .header("x-relay-token", token)
        .send();
    let response = tokio::time::timeout(SUBSCRIBE_REQUEST_TIMEOUT, request)
        .await
        .map_err(|_| anyhow::anyhow!("relay subscription request timed out"))??;
    if response.status() != reqwest::StatusCode::OK {
        anyhow::bail!(
            "relay subscription rejected with status {}",
            response.status()
        );
    }
    let mut stream = response.bytes_stream();
    let mut parser = SseDataParser::default();
    loop {
        let chunk = match tokio::time::timeout(READ_TIMEOUT, stream.next()).await {
            Ok(Some(Ok(chunk))) => chunk,
            Ok(Some(Err(error))) => anyhow::bail!("relay stream failed: {error:?}"),
            Ok(None) => return Ok(()),
            Err(_) => anyhow::bail!("relay stream stalled past the keep-alive interval"),
        };
        for payload in parser.push(&String::from_utf8_lossy(&chunk)) {
            match serde_json::from_str::<RelayedWatchNotification>(&payload) {
                Ok(notification) => apply(calendar_service, notification).await,
                Err(error) => {
                    tracing::warn!(error = ?error, "undecodable relayed watch notification");
                }
            }
        }
    }
}

/// Mirror of the webhook handler's dispatch for one relayed notification.
async fn apply(
    calendar_service: &CalendarService<PgCalendarRepository>,
    notification: RelayedWatchNotification,
) {
    if notification.state == "sync" {
        tracing::info!(
            channel_id = %notification.channel_id,
            "relayed watch channel handshake received"
        );
        return;
    }
    match calendar_service
        .handle_watch_notification(&notification.channel_id, &notification.resource_id)
        .await
    {
        Ok(matched) => {
            if !matched {
                tracing::debug!(
                    channel_id = %notification.channel_id,
                    "relayed calendar notification matched no active channel"
                );
            }
        }
        Err(error) => {
            tracing::warn!(
                error = ?error,
                channel_id = %notification.channel_id,
                "failed to apply relayed calendar watch notification"
            );
        }
    }
}

/// Best-effort stop of every open push channel, bounded so shutdown cannot
/// hang on a slow provider.
async fn stop_open_channels(
    db: PgPool,
    redis_client: RedisClient,
    auth_service_client: Arc<AuthServiceClient>,
) {
    let redis_conn = match redis_client.inner.get_multiplexed_async_connection().await {
        Ok(connection) => connection,
        Err(error) => {
            tracing::warn!(error = ?error, "cannot stop watch channels without redis");
            return;
        }
    };
    let repository = PgCalendarRepository::new(db);
    let provider_client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            tracing::warn!(error = ?error, "failed to build the channel stop http client");
            return;
        }
    };
    let provider = GoogleCalendarClient::with_gate(
        provider_client,
        RedisCalendarRequestGate::new(redis_client),
    );
    let tokens = CalendarTokenProviderAdapter::new(redis_conn, auth_service_client);
    match tokio::time::timeout(
        STOP_CHANNELS_TIMEOUT,
        stop_all_watch_channels(&repository, &provider, &tokens),
    )
    .await
    {
        Ok(Ok(summary)) => {
            tracing::info!(
                stopped = summary.stopped,
                failed = summary.failed,
                "stopped open calendar watch channels at shutdown"
            );
        }
        Ok(Err(error)) => {
            tracing::warn!(error = ?error, "failed to stop calendar watch channels at shutdown");
        }
        Err(_) => {
            tracing::warn!("timed out stopping calendar watch channels at shutdown");
        }
    }
}
