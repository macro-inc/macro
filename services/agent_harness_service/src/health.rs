//! The load balancer's health check, served off the main runtime.
//!
//! `/health` on the API listener runs on the main tokio runtime, so a runtime
//! saturated by work (a burst of session reattaches, say) failed it, ECS
//! replaced the task, and every runtime redialed into the survivors - more of
//! the same work. This listener runs on its own OS thread with its own
//! single-threaded runtime, so it answers while the main runtime is busy.
//!
//! It is still a liveness check, not an always-200: a task on the main runtime
//! ticks a heartbeat, and the check fails when that heartbeat is older than
//! [`MAIN_RUNTIME_STALL_LIMIT`] or its task has exited. A slow runtime stays in
//! service; a wedged one is replaced.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::Context;
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use tokio::sync::watch;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

#[cfg(test)]
mod test;

/// How long the main runtime may go without ticking its heartbeat before the
/// task reports unhealthy. Long enough that a runtime that is merely slow
/// stays in service; a stall this long is a wedge, not load.
const MAIN_RUNTIME_STALL_LIMIT: Duration = Duration::from_secs(30);

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);

/// When the main runtime last ran its heartbeat task, and whether that task is
/// still alive.
#[derive(Clone)]
pub struct MainRuntimeHeartbeat {
    last_tick: Arc<Mutex<Option<Instant>>>,
}

impl MainRuntimeHeartbeat {
    /// Start ticking on the current (main) runtime until `shutdown`, after
    /// which the check fails so a draining task leaves the load balancer.
    #[must_use]
    pub fn spawn(shutdown: CancellationToken, tasks: &TaskTracker) -> Self {
        let heartbeat = Self {
            last_tick: Arc::new(Mutex::new(Some(Instant::now()))),
        };
        let ticking = heartbeat.clone();
        tasks.spawn(async move {
            // Dropped when the task ends - shut down, panicked or aborted - so
            // the check fails at once instead of after the stall limit.
            let _stopped = StopOnDrop {
                heartbeat: ticking.clone(),
                shutdown: shutdown.clone(),
            };
            let mut interval = tokio::time::interval(HEARTBEAT_INTERVAL);
            loop {
                tokio::select! {
                    () = shutdown.cancelled() => break,
                    _ = interval.tick() => ticking.record_tick(),
                }
            }
        });
        heartbeat
    }

    fn record_tick(&self) {
        let mut last_tick = self.lock();
        if last_tick.is_some() {
            *last_tick = Some(Instant::now());
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Instant>> {
        // Only an `Option<Instant>` lives behind it, which a panic can't
        // leave half-written.
        self.last_tick
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// How long since the last tick, or `None` once the heartbeat task has
    /// exited.
    fn since_last_tick(&self) -> Option<Duration> {
        self.lock().map(|last_tick| last_tick.elapsed())
    }
}

struct StopOnDrop {
    heartbeat: MainRuntimeHeartbeat,
    shutdown: CancellationToken,
}

impl Drop for StopOnDrop {
    fn drop(&mut self) {
        *self.heartbeat.lock() = None;
        if !self.shutdown.is_cancelled() {
            tracing::error!("main runtime heartbeat stopped; health checks now fail");
        }
    }
}

/// What the health check reads: the main runtime's heartbeat, whether the
/// API listener is serving, and whether the runtime command bus is connected.
#[derive(Clone)]
pub struct Liveness {
    pub heartbeat: MainRuntimeHeartbeat,
    pub api_listening: watch::Receiver<bool>,
    pub runtime_commands_ready: watch::Receiver<bool>,
}

fn health_router(liveness: Liveness) -> Router {
    Router::new()
        .route("/health", get(health))
        .with_state(liveness)
}

async fn health(State(liveness): State<Liveness>) -> StatusCode {
    let Some(since_last_tick) = liveness.heartbeat.since_last_tick() else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };

    if since_last_tick >= MAIN_RUNTIME_STALL_LIMIT {
        tracing::warn!(
            main_runtime_stalled_ms = since_last_tick.as_millis(),
            "main runtime stalled; failing the health check"
        );
        return StatusCode::SERVICE_UNAVAILABLE;
    }

    let api_listening = *liveness.api_listening.borrow();
    let runtime_commands_ready = *liveness.runtime_commands_ready.borrow();
    if api_listening && runtime_commands_ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

/// Bind `port` now, so a taken port fails startup, then serve the health
/// check from a dedicated OS thread for the life of the process.
pub fn serve_on_own_thread(port: u16, liveness: Liveness) -> anyhow::Result<()> {
    let listener = std::net::TcpListener::bind(("0.0.0.0", port))
        .with_context(|| format!("failed to bind the health check to port {port}"))?;
    listener
        .set_nonblocking(true)
        .context("failed to make the health listener non-blocking")?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("failed to build the health check runtime")?;

    std::thread::Builder::new()
        .name("health-check".to_owned())
        .spawn(move || {
            let result = runtime.block_on(async move {
                let listener = tokio::net::TcpListener::from_std(listener)?;
                axum::serve(listener, health_router(liveness)).await
            });
            // Nothing answers the load balancer now, so ECS replaces the task.
            if let Err(error) = result {
                tracing::error!(error = ?error, "health check listener stopped");
            }
        })
        .context("failed to start the health check thread")?;
    tracing::info!(port, "health check listening on its own thread");
    Ok(())
}
