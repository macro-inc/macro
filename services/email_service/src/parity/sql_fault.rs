//! Inject a closed-pool failure at one chosen service acquisition, without racing it.

use sqlx::{PgPool, postgres::PgPoolOptions};
use std::sync::{
    Arc, OnceLock,
    atomic::{AtomicUsize, Ordering},
};

#[derive(Clone, Default)]
pub(super) struct SqlFault(Arc<State>);

#[derive(Default)]
struct State {
    pool: OnceLock<PgPool>,
    remaining: AtomicUsize,
}

impl SqlFault {
    pub fn options(&self) -> PgPoolOptions {
        let state = Arc::downgrade(&self.0);
        PgPoolOptions::new()
            .max_connections(1)
            .before_acquire(move |_, _| {
                let state = state.upgrade().expect("live lab SQL fault");
                Box::pin(async move {
                    if state
                        .remaining
                        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
                        == Ok(1)
                    {
                        // close() marks the pool closed synchronously. Its completion
                        // future is drained after the request returns this connection.
                        drop(state.pool.get().expect("registered pool").close());
                        return Ok(false);
                    }
                    Ok(true)
                })
            })
    }

    pub fn register(&self, pool: PgPool) {
        assert!(self.0.pool.set(pool).is_ok(), "one service pool per lab");
    }

    pub fn fail_acquisition(&self, index: usize) {
        assert!(index > 0, "acquisitions are numbered from one");
        self.0.remaining.store(index, Ordering::SeqCst);
    }

    pub async fn drain(&self) {
        let pool = self.0.pool.get().expect("registered pool");
        if pool.is_closed() {
            pool.close().await;
        }
    }
}
