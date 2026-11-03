//! `LISTEN` for the signals DSS and other replicas send through Postgres.
//! An outbound adapter (it holds a Postgres connection) that feeds the
//! supervisor.
//!
//! The listener runs on its own direct connection (a transaction pooler would
//! drop `LISTEN`). When it reconnects, notifications sent in between are lost,
//! so it emits [`Signal::Resync`] and the supervisor re-reads everything.
//!
//! Payloads are `whatsapp_linked`'s JSON signals; each one's `traceparent`
//! parents a `whatsapp.signal.receive` span that travels with the signal, so
//! the supervisor's and the runner's work continues the sender's trace.

use sqlx::postgres::{PgConnectOptions, PgListener, PgPoolOptions};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use external_chat::signals::trace_context;
use whatsapp_linked::signals::{
    ACCOUNT_CHANGED, ACCOUNT_RELEASED, GROUPS_REQUESTED, HISTORY_REQUESTED, LOOKUP_REQUESTED,
    PAIRING_REQUESTED, SEND_REQUESTED,
};

use crate::domain::ports::Traced;
use crate::domain::supervisor::Signal;

const CHANNELS: [&str; 7] = [
    ACCOUNT_RELEASED,
    PAIRING_REQUESTED,
    SEND_REQUESTED,
    GROUPS_REQUESTED,
    LOOKUP_REQUESTED,
    HISTORY_REQUESTED,
    ACCOUNT_CHANGED,
];

/// Signals queued for the supervisor before the listener waits.
pub const SIGNAL_CAPACITY: usize = 1024;

/// Errors starting the listener.
#[derive(Debug, thiserror::Error)]
pub enum ListenError {
    /// Connecting or subscribing failed.
    #[error("listening for WhatsApp signals failed: {0}")]
    Database(#[from] sqlx::Error),
}

/// A subscribed listener; [`SignalListener::run`] forwards its notifications.
pub struct SignalListener {
    listener: PgListener,
}

impl SignalListener {
    /// Connects and subscribes before returning, so no signal sent after this
    /// returns is missed.
    pub async fn connect(options: &PgConnectOptions) -> Result<Self, ListenError> {
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy_with(options.clone());
        let mut listener = PgListener::connect_with(&pool).await?;
        listener.listen_all(CHANNELS).await?;
        Ok(SignalListener { listener })
    }

    /// Forwards notifications until `stop` or until the supervisor goes away.
    pub async fn run(mut self, signals: mpsc::Sender<Traced<Signal>>, stop: CancellationToken) {
        loop {
            let received = tokio::select! {
                () = stop.cancelled() => return,
                received = self.listener.try_recv() => received,
            };
            let signal = match received {
                Ok(Some(notification)) => {
                    match parse(notification.channel(), notification.payload()) {
                        Some((signal, traceparent)) => {
                            let span = tracing::info_span!(
                                "whatsapp.signal.receive",
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
                                channel = notification.channel(),
                                "Ignoring a malformed WhatsApp signal"
                            );
                            continue;
                        }
                    }
                }
                // The connection dropped; the next call reconnects and resubscribes.
                Ok(None) => Signal::Resync.into(),
                Err(error) => {
                    tracing::warn!(error = %error, "WhatsApp signal listener failed; reconnecting");
                    Signal::Resync.into()
                }
            };
            if signals.send(signal).await.is_err() {
                return;
            }
        }
    }
}

/// Maps one notification to a signal and the sender's trace context; `None`
/// for unknown channels or payloads.
pub fn parse(channel: &str, payload: &str) -> Option<(Signal, Option<String>)> {
    let payload = external_chat::signals::Signal::parse(payload)?;
    let id = payload.id;
    let signal = match channel {
        ACCOUNT_RELEASED => Some(Signal::AccountReleased(id)),
        PAIRING_REQUESTED => Some(Signal::PairingRequested(id)),
        SEND_REQUESTED => Some(Signal::SendRequested(id)),
        GROUPS_REQUESTED => Some(Signal::GroupsRequested(id)),
        LOOKUP_REQUESTED => Some(Signal::LookupRequested(id)),
        HISTORY_REQUESTED => Some(Signal::HistoryRequested(id)),
        ACCOUNT_CHANGED => Some(Signal::AccountChanged(id)),
        _ => None,
    }?;
    Some((signal, payload.traceparent))
}
