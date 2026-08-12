//! Dev-only tunnel relaying Google Calendar push notifications to local stacks.
//!
//! Local `run_local` stacks cannot receive Google's `events.watch` webhooks —
//! the callback address must be public HTTPS on a domain verified in the
//! Cloud project owning the OAuth client. This service is that address:
//! local channels open against `/calendar/notifications` here with a
//! per-instance token, and each stack's pubsub workers subscribe OUT to
//! `/calendar/relay/subscribe` (SSE) for deliveries addressed to their
//! token. Deliveries are content-free header triples; a token with no live
//! subscriber (a torn-down stack's strays) is dropped on the floor.
//!
//! The service is deliberately stateless and dependency-free: fan-out is an
//! in-memory map, so it deploys as a single dev task. A restart drops
//! subscriber connections; they reconnect with backoff, and every local
//! stack's 5-minute poll remains the freshness backstop throughout.

mod api;
mod config;
mod registry;

use std::sync::Arc;

use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    let config = config::Config::from_env().context("expected to be able to generate config")?;
    if config.calendar_watch_relay_secret.trim().is_empty() {
        anyhow::bail!("CALENDAR_WATCH_RELAY_SECRET must not be blank");
    }
    let state = api::ApiContext {
        registry: registry::RelayRegistry::default(),
        secret: Arc::new(config.calendar_watch_relay_secret),
    };
    let app = api::router(state).layer(tower_http::trace::TraceLayer::new_for_http());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .with_context(|| format!("binding 0.0.0.0:{}", config.port))?;
    tracing::info!(
        environment = ?config.environment,
        port = config.port,
        "calendar-event-local-tunnel is up"
    );
    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(macro_entrypoint::shutdown_signal())
        .await
        .context("error starting service")
}
