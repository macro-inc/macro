//! This daemon's one connection to the harness service, and the one harness
//! process behind it.
//!
//! A daemon serves a single bot, and a bot's runtime is a single connection:
//! ACP initializes per connection and tags every session-scoped message with a
//! `sessionId`, so one socket and one harness process carry every session this
//! bot is running. The service decides which sessions those are - it binds a
//! session when work arrives for it - so nothing here is per-session at all.
//!
//! What that buys: a harness starts once per daemon rather than once per
//! session, so only the first mention after boot pays for a cold agent.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use agent_runtime_protocol::domain::connection::RuntimeChannel;
use tokio_retry::RetryIf;
use tokio_retry::strategy::{ExponentialBackoff, FixedInterval};
use tokio_tungstenite::tungstenite;

use crate::config::{Harness, MacroApi};
use crate::harness;
use crate::outbound::link;

/// A dial races the delivery that asked for it, so it retries quickly and
/// briefly: a proxy or service mid restart is worth waiting out, a longer
/// outage is better answered by failing the delivery and being redelivered.
const DIAL_ATTEMPTS: usize = 3;
const DIAL_RETRY_DELAY: Duration = Duration::from_millis(500);

/// How many times a dropped connection is rebuilt before the daemon waits for
/// its next delivery to try again. Bounded because a bridge that fails the
/// instant it starts - a harness binary that is missing, say - would otherwise
/// rebuild itself forever. Nobody is waiting on these, so they back off.
const REBUILD_ATTEMPTS: usize = 4;

/// The daemon's connection to its bot's sessions.
///
/// At most one is live. The flag is the claim on it: a delivery that finds it
/// unset dials, and the task serving the connection clears it on the way out,
/// so "set" always means "somebody is serving, or about to be".
pub struct Runtime {
    macro_api: MacroApi,
    harness: Harness,
    live: Arc<AtomicBool>,
}

impl Runtime {
    /// A runtime that dials with the given credentials and spawns the given
    /// harness.
    pub fn new(macro_api: MacroApi, harness: Harness) -> Self {
        Self {
            macro_api,
            harness,
            live: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Ensure this bot's runtime is connected, dialing if it is not. Returns
    /// once the dial has succeeded (or was unnecessary), with the harness
    /// bridged in a background task.
    pub async fn ensure_connected(&self) -> Result<(), tungstenite::Error> {
        if self
            .live
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Ok(());
        }

        let url = self.macro_api.gateway_url();
        let channel = match dial(&self.macro_api, &url, dial_strategy()).await {
            Ok(channel) => channel,
            Err(error) => {
                self.live.store(false, Ordering::Release);
                return Err(error);
            }
        };

        tokio::spawn(serve(
            url,
            channel,
            self.macro_api.clone(),
            self.harness.clone(),
            Arc::clone(&self.live),
        ));
        Ok(())
    }
}

/// Bridge the harness until the connection ends for good, rebuilding through
/// failures that look transient. Holds the claim for its whole life - including
/// across rebuilds, so a reconnecting runtime is never raced by a second one -
/// and releases it on the way out.
async fn serve(
    gateway_url: String,
    channel: RuntimeChannel,
    macro_api: MacroApi,
    harness: Harness,
    live: Arc<AtomicBool>,
) {
    tracing::info!("harness bridge starting");
    // A bridge that ends cleanly is a runtime that is done being asked for
    // anything; the next delivery dials again.
    match harness::bridge(&harness, channel).await {
        Ok(()) => tracing::info!("harness bridge ended"),
        Err(error) => {
            tracing::warn!(error = ?error, "harness bridge ended with an error");
            rebuild(&gateway_url, &macro_api, &harness).await;
        }
    }
    live.store(false, Ordering::Release);
}

/// Dial and serve again, as one retried operation: ending cleanly stops it, as
/// does a gateway verdict no retry can change.
async fn rebuild(gateway_url: &str, macro_api: &MacroApi, harness: &Harness) {
    let outcome = RetryIf::start(
        rebuild_strategy(),
        || async {
            let channel = dial(macro_api, gateway_url, dial_strategy())
                .await
                .map_err(ServeError::Dial)?;
            tracing::info!("harness bridge restarting");
            harness::bridge(harness, channel)
                .await
                .map_err(ServeError::Bridge)
        },
        worth_rebuilding,
    )
    .await;

    match outcome {
        Ok(()) => tracing::info!("harness bridge ended"),
        Err(error) => tracing::warn!(
            error = ?error,
            "could not keep a harness bridge up; waiting for the next delivery"
        ),
    }
}

/// Why serving the runtime stopped.
#[derive(Debug, thiserror::Error)]
enum ServeError {
    #[error(transparent)]
    Dial(tungstenite::Error),
    #[error(transparent)]
    Bridge(harness::BridgeError),
}

/// Whether rebuilding could plausibly go better. A failed bridge says nothing
/// about the next one, so only the gateway's own verdict stops this.
fn worth_rebuilding(error: &ServeError) -> bool {
    match error {
        ServeError::Dial(error) => worth_redialing(error),
        ServeError::Bridge(_) => true,
    }
}

/// Dial the gateway, retrying on the failures a retry can fix.
async fn dial(
    macro_api: &MacroApi,
    gateway_url: &str,
    strategy: impl IntoIterator<Item = Duration>,
) -> Result<RuntimeChannel, tungstenite::Error> {
    RetryIf::start(
        strategy,
        || link::dial(gateway_url, &macro_api.bot_token, &macro_api.bot_scope),
        worth_redialing,
    )
    .await
}

/// Whether dialing again could plausibly answer differently. A 4xx is the
/// gateway's verdict on this bot - not an agent bot, credentials refused - and
/// asking again only repeats it.
fn worth_redialing(error: &tungstenite::Error) -> bool {
    !matches!(
        error,
        tungstenite::Error::Http(response) if response.status().is_client_error()
    )
}

fn dial_strategy() -> impl Iterator<Item = Duration> {
    FixedInterval::new(DIAL_RETRY_DELAY).take(DIAL_ATTEMPTS - 1)
}

fn rebuild_strategy() -> impl Iterator<Item = Duration> {
    ExponentialBackoff::from_millis(2)
        .factor(500)
        .take(REBUILD_ATTEMPTS - 1)
}
