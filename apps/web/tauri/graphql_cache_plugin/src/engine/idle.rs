//! Idle WAL checkpoint. Turso copies the WAL into the database file inside
//! the COMMIT that takes it to 1,000 frames, so one write pays for the copy
//! the others caused. Once the engine has been quiet for a moment after a
//! command, this copies it from 500 frames instead, while no command waits.
//! The browser host does the same (`worker-core.ts`).
use super::access::IdleHolds;
use super::{EngineAccess, EngineState};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

/// Long enough for the commands a page sends on an answer (the re-reads after
/// a write's change notice) to arrive and run first; the browser host waits
/// as long.
const QUIET: Duration = Duration::from_millis(100);

/// Arms the idle checkpoint on `access`. The task holds only a weak reference
/// while it waits, so the engine can still close.
pub(super) fn install(access: &Arc<EngineAccess<EngineState>>) {
    let weak = Arc::downgrade(access);
    access.on_quiet(move |holds, released| {
        tauri::async_runtime::spawn(wait_then_checkpoint(weak.clone(), holds, released));
    });
}

async fn wait_then_checkpoint(
    access: Weak<EngineAccess<EngineState>>,
    holds: Arc<IdleHolds>,
    mut seen: u64,
) {
    loop {
        tokio::time::sleep(QUIET).await;
        // Counted, so shutdown waits for this reference instead of failing.
        let Some(engine) = holds.hold(&access) else {
            return;
        };
        let releases = engine.quiet_releases();
        if releases == seen {
            checkpoint(&engine);
            return;
        }
        seen = releases;
    }
}

/// Copies the WAL when it is due, unless a command holds or waits for the
/// engine; that command's release arms the next attempt. A failed copy is
/// logged and leaves Turso's own checkpoint in COMMIT; it never resets.
fn checkpoint(access: &EngineAccess<EngineState>) {
    let Some(state) = access.try_idle() else {
        return;
    };
    let span = tracing::info_span!(
        "graphql_cache.native.wal_checkpoint",
        graphql_cache.checkpoint.ran = tracing::field::Empty,
        graphql_cache.checkpoint.wal_frames = tracing::field::Empty,
        graphql_cache.checkpoint.backfilled_frames = tracing::field::Empty,
        graphql_cache.checkpoint.duration_ms = tracing::field::Empty,
    );
    let _entered = span.enter();
    let started = Instant::now();
    match state.engine.storage().checkpoint_if_due() {
        Ok(checkpoint) => {
            #[cfg(test)]
            if checkpoint.ran {
                record_for_bench(started, checkpoint);
            }
            span.record("graphql_cache.checkpoint.ran", checkpoint.ran);
            span.record("graphql_cache.checkpoint.wal_frames", checkpoint.wal_frames);
            span.record(
                "graphql_cache.checkpoint.backfilled_frames",
                checkpoint.backfilled_frames,
            );
        }
        Err(error) => {
            tracing::warn!(error = %error, "graphql cache idle checkpoint failed; COMMIT keeps checkpointing");
        }
    }
    span.record(
        "graphql_cache.checkpoint.duration_ms",
        started.elapsed().as_secs_f64() * 1_000.0,
    );
}

/// Copies that ran, with how long each took, for the native bench to read.
#[cfg(test)]
static COPIES: std::sync::Mutex<Vec<(f64, cache_turso::WalCheckpoint)>> =
    std::sync::Mutex::new(Vec::new());

#[cfg(test)]
fn record_for_bench(started: Instant, checkpoint: cache_turso::WalCheckpoint) {
    let ms = started.elapsed().as_secs_f64() * 1_000.0;
    COPIES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .push((ms, checkpoint));
}

/// Takes the copies recorded since the last call.
#[cfg(test)]
pub(super) fn take_copies() -> Vec<(f64, cache_turso::WalCheckpoint)> {
    std::mem::take(
        &mut *COPIES
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
    )
}
