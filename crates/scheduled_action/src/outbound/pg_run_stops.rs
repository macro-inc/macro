//! Stop requests sent to every harness instance through Postgres `NOTIFY`,
//! since a run executes on whichever instance claimed it.

#[cfg(test)]
mod test;

use std::time::Duration;

use anyhow::Result;
use axum::http::HeaderMap;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use sqlx::postgres::PgListener;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::domain::run_stops::{RunStops, StopRelay};

/// `pg_notify` channel for stopping a run. The payload is a [`StopNotice`].
const RUN_STOP_CHANNEL: &str = "scheduled_action_run_stop";

/// How long a failed listener waits before connecting again.
const RECONNECT_DELAY: Duration = Duration::from_secs(1);

/// What a stop carries between instances.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct StopNotice {
    /// The run's claim token.
    run: Uuid,
    /// The stopping request's trace, recorded where the stop is heard.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    traceparent: Option<String>,
}

/// Sends stops on [`RUN_STOP_CHANNEL`].
pub struct PgStopRelay {
    db: PgPool,
}

impl PgStopRelay {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

#[async_trait::async_trait]
impl StopRelay for PgStopRelay {
    async fn send(&self, run: Uuid) -> Result<()> {
        let payload = serde_json::to_string(&StopNotice {
            run,
            traceparent: current_traceparent(),
        })?;
        sqlx::query!("SELECT pg_notify($1, $2)", RUN_STOP_CHANNEL, payload)
            .execute(&self.db)
            .await?;
        Ok(())
    }
}

/// The current span's W3C trace context, when it has one.
fn current_traceparent() -> Option<String> {
    let mut headers = HeaderMap::new();
    macro_tower_layers::inject_trace_headers(&mut headers);
    headers
        .get("traceparent")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

/// Hear stops on `pool`'s database until `shutdown` and pass each to
/// `stops`, on a task `tracker` tracks. Returns once the first attempt to
/// listen has finished, so a stop sent after it is heard; a failed attempt is
/// retried in the background. A stop sent while the connection is down is
/// lost, and its run ends at its deadline as before.
pub async fn listen_for_stops(
    pool: PgPool,
    stops: RunStops,
    tracker: &TaskTracker,
    shutdown: CancellationToken,
) {
    let first = subscribe(&pool).await;
    tracker.spawn(async move {
        let mut listener = first;
        loop {
            let error = match listener {
                Ok(listener) => tokio::select! {
                    biased;
                    () = shutdown.cancelled() => return,
                    error = relay(listener, &stops) => error,
                },
                Err(error) => error,
            };
            tracing::warn!(error = %error, "routine run stop listener failed; reconnecting");
            tokio::select! {
                biased;
                () = shutdown.cancelled() => return,
                () = tokio::time::sleep(RECONNECT_DELAY) => {}
            }
            listener = subscribe(&pool).await;
        }
    });
}

async fn subscribe(pool: &PgPool) -> Result<PgListener, sqlx::Error> {
    let mut listener = PgListener::connect_with(pool).await?;
    listener.listen(RUN_STOP_CHANNEL).await?;
    Ok(listener)
}

/// Pass stops on until the connection fails for good.
async fn relay(mut listener: PgListener, stops: &RunStops) -> sqlx::Error {
    loop {
        match listener.recv().await {
            Ok(notification) => heard(notification.payload(), stops),
            Err(error) => return error,
        }
    }
}

/// One stop arrived. It can't carry the stopping request's span across
/// Postgres, so its span records that request's trace instead.
#[tracing::instrument(name = "routine.stop_heard", skip_all, fields(run_id = tracing::field::Empty, stop_traceparent = tracing::field::Empty))]
fn heard(payload: &str, stops: &RunStops) {
    let notice = match serde_json::from_str::<StopNotice>(payload) {
        Ok(notice) => notice,
        Err(error) => {
            tracing::warn!(error = %error, "unreadable routine run stop");
            return;
        }
    };
    let span = tracing::Span::current();
    span.record("run_id", tracing::field::display(notice.run));
    if let Some(traceparent) = &notice.traceparent {
        span.record("stop_traceparent", traceparent.as_str());
    }
    stops.heard(notice.run);
}
