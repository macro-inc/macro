//! The runtime gateway: where user-run harnesses dial in to serve their agents.
//!
//! `GET /runtime/ws`, authenticated with the harness credential header
//! (`x-macro-harness-token`) - a WebSocket upgrade is an ordinary HTTP request,
//! and every runtime dialing in is a real client that can set headers.
//!
//! One connection per harness, not per bot or per session. ACP initializes per
//! connection and carries a `sessionId` on every session-scoped method, so one
//! socket and one harness process serve every session of every agent bound to
//! the harness. Which sessions those are is not something the dial declares:
//! the runtime dials once, and sessions are bound to the connection as work
//! arrives for them. The registry initializes each dial and calls ACP
//! `session/list`, and the harness loads the sessions listed; any other
//! session prompted after a reconnect restores itself on the way.
//!
//! The token is the whole gate: a valid, unrevoked credential on a live
//! (undeleted) harness is exactly what the authorizer verifies, so a revoked
//! harness fails authentication rather than a later fact check.
//!
//! Every accepted dial costs this replica a handshake, `session/list` and a
//! reattach of the sessions listed, so a harness stuck in a redial loop is
//! refused before the upgrade by its [`DialBudget`]: `429 Too Many Requests`
//! with `Retry-After`.

use std::collections::HashMap;
use std::num::NonZeroU32;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_runtime_protocol::outbound::websocket::connect_socket;
use axum::Router;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{FromRef, State};
use axum::http::StatusCode;
use axum::http::header::RETRY_AFTER;
use axum::response::{IntoResponse as _, Response};
use axum::routing::get;
use harness_id::HarnessId;
use macro_authorization::{
    HarnessOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use tokio::time::Instant;
use tracing::Instrument as _;

use crate::outbound::runtime_registry::RuntimeRegistry;

#[cfg(test)]
mod test;

/// The sending half of an accepted dial, shared by every session on it.
pub type GatewaySender = tokio::sync::mpsc::UnboundedSender<ToRuntimeMessage>;

/// State for the runtime gateway route.
pub struct RuntimeGatewayState<Auth> {
    runtimes: Arc<RuntimeRegistry<GatewaySender>>,
    authorization_state: MacroAuthorizationState<Auth>,
    dials: Arc<DialBudget>,
}

impl<Auth> RuntimeGatewayState<Auth> {
    /// Create gateway state with the default [`DialBudget`].
    pub fn new(
        runtimes: Arc<RuntimeRegistry<GatewaySender>>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            runtimes,
            authorization_state,
            dials: Arc::new(DialBudget::default()),
        }
    }

    /// Replace the dial budget.
    pub fn with_dial_budget(mut self, dials: DialBudget) -> Self {
        self.dials = Arc::new(dials);
        self
    }
}

// Manual Clone impl: everything is behind an Arc.
impl<Auth> Clone for RuntimeGatewayState<Auth> {
    fn clone(&self) -> Self {
        Self {
            runtimes: Arc::clone(&self.runtimes),
            authorization_state: self.authorization_state.clone(),
            dials: Arc::clone(&self.dials),
        }
    }
}

impl<Auth> FromRef<RuntimeGatewayState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &RuntimeGatewayState<Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the router serving `GET /ws`. Mount it under `/runtime`.
pub fn runtime_gateway_router<Auth, S>(state: RuntimeGatewayState<Auth>) -> Router<S>
where
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/ws", get(dial_handler::<Auth>))
        .with_state(state)
}

/// Authenticate a dial, spend one of its harness's dials, and take the socket
/// as this harness's connection.
#[tracing::instrument(
    name = "agent.runtime.dial",
    skip_all,
    fields(
        harness = %caller.authorization.harness_id,
        agent.runtime.dial_outcome = tracing::field::Empty,
        agent.runtime.dial_retry_after_seconds = tracing::field::Empty,
    )
)]
async fn dial_handler<Auth>(
    State(state): State<RuntimeGatewayState<Auth>>,
    caller: MacroAuthorizationExtractor<Auth, HarnessOnly>,
    ws: WebSocketUpgrade,
) -> Response
where
    Auth: MacroAuthorizationService,
{
    let harness = caller.authorization.harness_id;
    let span = tracing::Span::current();

    if let DialAdmission::Refused { retry_after } = state.dials.admit(harness, Instant::now()) {
        let retry_after_seconds = whole_seconds_after(retry_after);
        span.record(
            "agent.runtime.dial_outcome",
            DialOutcome::RateLimited.as_str(),
        );
        span.record(
            "agent.runtime.dial_retry_after_seconds",
            retry_after_seconds,
        );
        tracing::warn!(
            %harness,
            retry_after_seconds,
            "refused a runtime dial: the harness is redialing faster than its budget"
        );
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(RETRY_AFTER, retry_after_seconds.to_string())],
        )
            .into_response();
    }
    span.record("agent.runtime.dial_outcome", DialOutcome::Accepted.as_str());

    let runtimes = Arc::clone(&state.runtimes);
    ws.on_upgrade(move |socket| {
        async move {
            let transport = connect_socket::<ToRuntimeMessage, ToServerMessage>(socket);
            // Last dial wins. A runtime that redials has lost its old socket
            // whether or not this side has noticed, so displacing is the only
            // answer that lets it recover.
            runtimes.attach(harness, transport);
            tracing::info!(%harness, "a runtime dialed in");
        }
        .instrument(span)
    })
}

/// What the gateway did with a dial, as recorded on its span.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DialOutcome {
    Accepted,
    RateLimited,
}

impl DialOutcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::RateLimited => "rate_limited",
        }
    }
}

/// `Retry-After` is whole seconds; round up so a runtime that honors it is
/// admitted, and never answer 0.
fn whole_seconds_after(wait: Duration) -> u64 {
    let seconds = wait.as_secs() + u64::from(wait.subsec_nanos() > 0);
    seconds.max(1)
}

/// Dials per harness this replica admits per [`DEFAULT_DIAL_WINDOW`].
const DEFAULT_DIALS_PER_WINDOW: NonZeroU32 = NonZeroU32::new(6).expect("6 is not zero");
const DEFAULT_DIAL_WINDOW: Duration = Duration::from_secs(60);
/// Harnesses tracked at once before the budget forgets the ones back at full
/// budget, which are indistinguishable from never having dialed.
const MAX_TRACKED_HARNESSES: usize = 10_000;

/// Whether a dial may proceed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialAdmission {
    /// The dial spent one of the harness's dials.
    Admitted,
    /// The harness has no dial left; one frees up after `retry_after`.
    Refused {
        /// How long until the harness's next dial would be admitted.
        retry_after: Duration,
    },
}

/// A per-replica, in-memory dial budget per harness: `dials` per `window`,
/// spent as a burst or spread out, refilling one dial every `window / dials`.
///
/// A generic cell rate algorithm: each harness keeps one instant, the time
/// at which its budget would be full again, so memory is one entry per
/// harness that dialed within the last window.
#[derive(Debug)]
pub struct DialBudget {
    /// Time one dial takes to refill.
    interval: Duration,
    /// How far ahead of now a harness's full-again time may run and still be
    /// admitted: the burst beyond the first dial.
    tolerance: Duration,
    /// Harnesses tracked at once; see [`MAX_TRACKED_HARNESSES`].
    max_tracked: usize,
    full_again: Mutex<HashMap<HarnessId, Instant>>,
}

impl Default for DialBudget {
    fn default() -> Self {
        Self::new(DEFAULT_DIALS_PER_WINDOW, DEFAULT_DIAL_WINDOW)
    }
}

impl DialBudget {
    /// Admit `dials` per `window` per harness.
    pub fn new(dials: NonZeroU32, window: Duration) -> Self {
        let interval = window / dials.get();
        Self {
            interval,
            tolerance: interval * (dials.get() - 1),
            max_tracked: MAX_TRACKED_HARNESSES,
            full_again: Mutex::new(HashMap::new()),
        }
    }

    /// Spend one of `harness`'s dials at `now`, or say when the next is due.
    pub fn admit(&self, harness: HarnessId, now: Instant) -> DialAdmission {
        let mut full_again = self
            .full_again
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let due = full_again.get(&harness).copied().unwrap_or(now).max(now);
        let ahead = due - now;
        if ahead > self.tolerance {
            return DialAdmission::Refused {
                retry_after: ahead - self.tolerance,
            };
        }
        if full_again.len() >= self.max_tracked && !full_again.contains_key(&harness) {
            full_again.retain(|_, full| *full > now);
            if full_again.len() >= self.max_tracked {
                // Every tracked harness dialed within the window; admit
                // rather than refuse a harness for others' dials.
                tracing::warn!(%harness, tracked = full_again.len(), "dial budget is full; admitting untracked");
                return DialAdmission::Admitted;
            }
        }
        full_again.insert(harness, due + self.interval);
        DialAdmission::Admitted
    }
}
