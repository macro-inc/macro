//! Worker monotonic clock; document state belongs to Room.
use std::cell::Cell;
use std::time::Duration;
use web_time::Instant;

pub use sync_server_core::domain::state::RootChange;

thread_local! {
    static MONOTONIC_ORIGIN: Cell<Option<Instant>> = const { Cell::new(None) };
}

pub(crate) fn monotonic() -> Duration {
    let instant = Instant::now();
    #[cfg(feature = "transcript")]
    let instant = crate::transcript::instant("state_instant", instant);
    MONOTONIC_ORIGIN.with(|origin| {
        let first = origin.get().unwrap_or(instant);
        origin.set(Some(first));
        instant.duration_since(first)
    })
}
