//! The Slack channels DSS and other replicas `NOTIFY`: account work for
//! `session_fleet::listener`, and sign-in attempts for the login worker.

use external_chat::signals::trace_context;
use session_fleet::listener::Channels;
use session_fleet::supervisor::FleetSignal;
use slack_linked::signals::{
    ACCOUNT_CHANGED, ACCOUNT_RELEASED, CATALOGUE_REQUESTED, HISTORY_REQUESTED, LOGIN_REQUESTED,
    READ_REQUESTED, SEND_REQUESTED,
};
use sqlx::postgres::{PgConnectOptions, PgListener, PgPoolOptions};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::domain::ports::AccountSignal;

const NAMES: [&str; 6] = [
    ACCOUNT_RELEASED,
    ACCOUNT_CHANGED,
    CATALOGUE_REQUESTED,
    HISTORY_REQUESTED,
    SEND_REQUESTED,
    READ_REQUESTED,
];

/// What the Slack fleet listens to.
pub fn channels() -> Channels<AccountSignal> {
    Channels {
        fleet: "slack",
        names: &NAMES,
        parse,
        resync: AccountSignal::Resync,
    }
}

/// Maps one notification to a fleet signal; `None` for unknown channels.
pub fn parse(channel: &str, id: Uuid) -> Option<FleetSignal<AccountSignal>> {
    let account = |signal, take| FleetSignal::Account {
        account: id,
        signal,
        take,
    };
    match channel {
        ACCOUNT_RELEASED => Some(FleetSignal::Released(id)),
        ACCOUNT_CHANGED => Some(account(AccountSignal::Changed, true)),
        CATALOGUE_REQUESTED => Some(account(AccountSignal::Catalogue, false)),
        HISTORY_REQUESTED => Some(account(AccountSignal::History, false)),
        SEND_REQUESTED => Some(account(AccountSignal::Send, false)),
        READ_REQUESTED => Some(account(AccountSignal::Read, false)),
        _ => None,
    }
}

/// A sign-in attempt that has input, with its sender's span.
pub struct LoginRequest {
    /// The attempt.
    pub attempt: Uuid,
    /// `slack.signal.receive` of the notification.
    pub span: tracing::Span,
}

/// `LISTEN slack_login_requested` until `stop`; a reconnect sends `None` so
/// the worker sweeps for attempts whose notification was missed.
pub async fn listen_logins(
    options: &PgConnectOptions,
    stop: CancellationToken,
) -> Result<mpsc::Receiver<Option<LoginRequest>>, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_lazy_with(options.clone());
    let mut listener = PgListener::connect_with(&pool).await?;
    listener.listen(LOGIN_REQUESTED).await?;
    let (sender, receiver) = mpsc::channel(256);
    tokio::spawn(async move {
        loop {
            let received = tokio::select! {
                () = stop.cancelled() => return,
                received = listener.try_recv() => received,
            };
            let request = match received {
                Ok(Some(notification)) => {
                    let Some(payload) =
                        external_chat::signals::Signal::parse(notification.payload())
                    else {
                        continue;
                    };
                    let span = tracing::info_span!(
                        "slack.signal.receive",
                        channel = notification.channel(),
                        login_id = %payload.id,
                    );
                    trace_context::adopt(&span, payload.traceparent.as_deref());
                    Some(LoginRequest {
                        attempt: payload.id,
                        span,
                    })
                }
                Ok(None) => None,
                Err(error) => {
                    tracing::warn!(error = %error, "Slack sign-in listener failed; reconnecting");
                    None
                }
            };
            if sender.send(request).await.is_err() {
                return;
            }
        }
    });
    Ok(receiver)
}
