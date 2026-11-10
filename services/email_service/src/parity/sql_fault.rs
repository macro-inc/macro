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
    pause: std::sync::Mutex<Option<Pause>>,
    remaining: AtomicUsize,
}

struct Pause {
    remaining: usize,
    arrived: tokio::sync::oneshot::Sender<()>,
    release: tokio::sync::oneshot::Receiver<()>,
}

impl SqlFault {
    pub fn options(&self) -> PgPoolOptions {
        let state = Arc::downgrade(&self.0);
        PgPoolOptions::new()
            .max_connections(1)
            .before_acquire(move |_, _| {
                let state = state.upgrade().expect("live lab SQL fault");
                Box::pin(async move {
                    let pause = {
                        let mut slot = state.pause.lock().expect("acquisition pause");
                        if let Some(pause) = slot.as_mut() {
                            pause.remaining -= 1;
                            if pause.remaining == 0 {
                                slot.take()
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    };
                    if let Some(pause) = pause {
                        let _ = pause.arrived.send(());
                        pause.release.await.expect("release acquisition");
                    }
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

    /// Pause exactly one acquisition so a scenario can reproduce a concurrent DB change.
    pub fn pause_acquisition(
        &self,
        index: usize,
    ) -> (
        tokio::sync::oneshot::Receiver<()>,
        tokio::sync::oneshot::Sender<()>,
    ) {
        assert!(index > 0);
        let (arrived, receiver) = tokio::sync::oneshot::channel();
        let (release, resume) = tokio::sync::oneshot::channel();
        *self.0.pause.lock().expect("acquisition pause") = Some(Pause {
            remaining: index,
            arrived,
            release: resume,
        });
        (receiver, release)
    }

    pub async fn drain(&self) {
        let pool = self.0.pool.get().expect("registered pool");
        if pool.is_closed() {
            pool.close().await;
        }
    }
}
