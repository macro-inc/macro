//! `LISTEN` for the signals DSS and other replicas send through Postgres.
//! An outbound adapter (it holds a Postgres connection) that feeds the
//! supervisor.
//!
//! The listener runs on its own direct connection (a transaction pooler would
//! drop `LISTEN`). When it reconnects, notifications sent in between are lost,
//! so it emits [`Signal::Resync`] and the supervisor re-reads everything.

use sqlx::postgres::{PgConnectOptions, PgListener, PgPoolOptions};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::domain::supervisor::{ACCOUNT_RELEASED, Signal};

/// `whatsapp_pairing_requested`, `<pairing_id>`.
pub const PAIRING_REQUESTED: &str = "whatsapp_pairing_requested";
/// `whatsapp_send_requested`, `<account_id>`.
pub const SEND_REQUESTED: &str = "whatsapp_send_requested";
/// `whatsapp_groups_requested`, `<account_id>`.
pub const GROUPS_REQUESTED: &str = "whatsapp_groups_requested";
/// `whatsapp_account_changed`, `<account_id>`.
pub const ACCOUNT_CHANGED: &str = "whatsapp_account_changed";

const CHANNELS: [&str; 5] = [
    ACCOUNT_RELEASED,
    PAIRING_REQUESTED,
    SEND_REQUESTED,
    GROUPS_REQUESTED,
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
    pub async fn run(mut self, signals: mpsc::Sender<Signal>, stop: CancellationToken) {
        loop {
            let received = tokio::select! {
                () = stop.cancelled() => return,
                received = self.listener.try_recv() => received,
            };
            let signal = match received {
                Ok(Some(notification)) => {
                    match parse(notification.channel(), notification.payload()) {
                        Some(signal) => signal,
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
                Ok(None) => Signal::Resync,
                Err(error) => {
                    tracing::warn!(error = ?error, "WhatsApp signal listener failed; reconnecting");
                    Signal::Resync
                }
            };
            if signals.send(signal).await.is_err() {
                return;
            }
        }
    }
}

/// Maps one notification to a signal; `None` for unknown channels or payloads.
pub fn parse(channel: &str, payload: &str) -> Option<Signal> {
    let id = Uuid::parse_str(payload).ok()?;
    match channel {
        ACCOUNT_RELEASED => Some(Signal::AccountReleased(id)),
        PAIRING_REQUESTED => Some(Signal::PairingRequested(id)),
        SEND_REQUESTED => Some(Signal::SendRequested(id)),
        GROUPS_REQUESTED => Some(Signal::GroupsRequested(id)),
        ACCOUNT_CHANGED => Some(Signal::AccountChanged(id)),
        _ => None,
    }
}
