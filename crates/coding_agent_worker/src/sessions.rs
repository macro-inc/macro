//! The daemon's live bridges: one per session it is currently serving.

use std::sync::Arc;
use std::time::Duration;

use agent_runtime_protocol::domain::connection::RuntimeChannel;
use agent_session::domain::model::AgentSessionId;
use dashmap::DashSet;
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

/// How many times a dropped bridge is rebuilt before the session is left to
/// its next mention. Bounded because a bridge that fails the instant it
/// starts - a harness binary that is missing, say - would otherwise rebuild
/// itself forever. Nobody is waiting on these, so they back off properly.
const REBUILD_ATTEMPTS: usize = 4;

/// One daemon's live bridges.
///
/// Membership is the claim on a session: a bridge task inserts before it
/// dials and removes itself on its way out, so "present" means "somebody is
/// already serving this, or about to be". Claiming through the insert
/// itself is what makes two deliveries racing for one session safe.
pub struct Bridges {
    macro_api: MacroApi,
    harness: Harness,
    live: Arc<DashSet<AgentSessionId>>,
}

impl Bridges {
    /// A registry that dials with the given credentials and spawns the given
    /// harness per session.
    pub fn new(macro_api: MacroApi, harness: Harness) -> Self {
        Self {
            macro_api,
            harness,
            live: Arc::new(DashSet::new()),
        }
    }

    /// Ensure a bridge is serving `session`, dialing `gateway_url` if none
    /// is. Returns once the dial has succeeded (or was unnecessary), with
    /// the bridge itself running as a background task.
    pub async fn ensure(
        &self,
        session: AgentSessionId,
        gateway_url: &str,
    ) -> Result<(), tungstenite::Error> {
        if !self.live.insert(session) {
            return Ok(());
        }

        let channel = match dial(&self.macro_api, gateway_url, dial_strategy()).await {
            Ok(channel) => channel,
            Err(error) => {
                self.live.remove(&session);
                return Err(error);
            }
        };

        tokio::spawn(serve(
            session,
            gateway_url.to_owned(),
            channel,
            self.macro_api.clone(),
            self.harness.clone(),
            Arc::clone(&self.live),
        ));
        Ok(())
    }

    /// Ensure a bridge for a session this daemon did not just create: the
    /// dial-in URL is derived from the API base instead of a create
    /// response.
    pub async fn ensure_by_id(&self, session: AgentSessionId) -> Result<(), tungstenite::Error> {
        let url = self.macro_api.gateway_url(&session.to_string());
        self.ensure(session, &url).await
    }
}

/// Bridge `session` until it ends for good, redialing through failures that
/// look transient. Holds the session's claim for its whole life - including
/// across redials, so a reconnecting bridge is never raced by a second one -
/// and releases it on the way out.
async fn serve(
    session: AgentSessionId,
    gateway_url: String,
    channel: RuntimeChannel,
    macro_api: MacroApi,
    harness: Harness,
    live: Arc<DashSet<AgentSessionId>>,
) {
    tracing::info!(%session, "bridge starting");
    // The channel the caller already dialed gets its run here; a bridge that
    // ends cleanly is a session done being served, and rebuilding it would
    // only spawn a harness nobody asked for. Its next mention dials again
    // through `ensure_by_id`.
    match harness::bridge(&harness, channel).await {
        Ok(()) => {
            tracing::info!(%session, "bridge ended");
            live.remove(&session);
            return;
        }
        Err(error) => tracing::warn!(error = ?error, %session, "bridge ended with an error"),
    }

    // Everything after is one retried operation: dial, then serve what the
    // dial returned. Ending cleanly stops it, as does a gateway verdict no
    // retry can change.
    let outcome = RetryIf::start(
        rebuild_strategy(),
        || async {
            let channel = dial(&macro_api, &gateway_url, dial_strategy())
                .await
                .map_err(ServeError::Dial)?;
            tracing::info!(%session, "bridge restarting");
            harness::bridge(&harness, channel)
                .await
                .map_err(ServeError::Bridge)
        },
        worth_rebuilding,
    )
    .await;

    match outcome {
        Ok(()) => tracing::info!(%session, "bridge ended"),
        Err(error) => tracing::warn!(
            error = ?error,
            %session,
            "could not keep a bridge up; leaving the session to its next mention"
        ),
    }
    live.remove(&session);
}

/// Why serving a session stopped.
#[derive(Debug, thiserror::Error)]
enum ServeError {
    #[error(transparent)]
    Dial(tungstenite::Error),
    #[error(transparent)]
    Bridge(harness::BridgeError),
}

/// Whether rebuilding the bridge could plausibly go better. A failed bridge
/// says nothing about the next one, so only the gateway's own verdict stops
/// this.
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
/// gateway's verdict on this bot and this session - no such session, not
/// this bot's, credentials refused - and asking again only repeats it.
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
