//! `LISTEN` for the signals DSS and other replicas send through Postgres, on
//! its own direct connection (a transaction pooler would drop `LISTEN`). When
//! it reconnects, notifications sent in between are lost, so it emits
//! [`FleetSignal::Resync`] and the supervisor re-reads everything.
//!
//! Payloads are `external_chat::signals::Signal` JSON; each one's
//! `traceparent` parents a `session_fleet.signal.receive` span that travels
//! with the signal, so the supervisor's and the runner's work continues the
//! sender's trace.

use sqlx::postgres::{PgConnectOptions, PgListener, PgPoolOptions};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use external_chat::signals::trace_context;

use crate::ports::Traced;
use crate::supervisor::FleetSignal;

/// Signals queued for the supervisor before the listener waits.
pub const SIGNAL_CAPACITY: usize = 1024;

/// Errors starting the listener.
#[derive(Debug, thiserror::Error)]
pub enum ListenError {
    /// Connecting or subscribing failed.
    #[error("listening for session signals failed: {0}")]
    Database(#[from] sqlx::Error),
}

/// What a fleet listens to and how its notifications become signals.
pub struct Channels<Signal> {
    /// The `fleet` field of the receive span.
    pub fleet: &'static str,
    /// The channels to `LISTEN` on.
    pub names: &'static [&'static str],
    /// A notification's signal, from its channel and id; `None` for channels
    /// this fleet doesn't know.
    pub parse: fn(&str, Uuid) -> Option<FleetSignal<Signal>>,
    /// What every runner is told after a reconnect.
    pub resync: Signal,
}

/// A subscribed listener; [`SignalListener::run`] forwards its notifications.
pub struct SignalListener<Signal> {
    listener: PgListener,
    channels: Channels<Signal>,
}

impl<Signal: Clone + std::fmt::Debug> SignalListener<Signal> {
    /// Connects and subscribes before returning, so no signal sent after this
    /// returns is missed.
    pub async fn connect(
        options: &PgConnectOptions,
        channels: Channels<Signal>,
    ) -> Result<Self, ListenError> {
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy_with(options.clone());
        let mut listener = PgListener::connect_with(&pool).await?;
        listener.listen_all(channels.names.iter().copied()).await?;
        Ok(SignalListener { listener, channels })
    }

    /// Forwards notifications until `stop` or until the supervisor goes away.
    pub async fn run(
        mut self,
        signals: mpsc::Sender<Traced<FleetSignal<Signal>>>,
        stop: CancellationToken,
    ) {
        loop {
            let received = tokio::select! {
                () = stop.cancelled() => return,
                received = self.listener.try_recv() => received,
            };
            let signal = match received {
                Ok(Some(notification)) => {
                    let parsed = external_chat::signals::Signal::parse(notification.payload())
                        .and_then(|payload| {
                            (self.channels.parse)(notification.channel(), payload.id)
                                .map(|signal| (signal, payload.traceparent))
                        });
                    match parsed {
                        Some((signal, traceparent)) => {
                            let span = tracing::info_span!(
                                "session_fleet.signal.receive",
                                fleet = self.channels.fleet,
                                channel = notification.channel(),
                                signal = ?signal,
                            );
                            trace_context::adopt(&span, traceparent.as_deref());
                            // Handed on: the supervisor and the account's
                            // runner do the signal's work inside it.
                            Traced { signal, span }
                        }
                        None => {
                            tracing::warn!(
                                fleet = self.channels.fleet,
                                channel = notification.channel(),
                                "Ignoring a malformed session signal"
                            );
                            continue;
                        }
                    }
                }
                // The connection dropped; the next call reconnects and resubscribes.
                Ok(None) => FleetSignal::Resync(self.channels.resync.clone()).into(),
                Err(error) => {
                    tracing::warn!(
                        fleet = self.channels.fleet,
                        error = %error,
                        "Session signal listener failed; reconnecting"
                    );
                    FleetSignal::Resync(self.channels.resync.clone()).into()
                }
            };
            if signals.send(signal).await.is_err() {
                return;
            }
        }
    }
}
