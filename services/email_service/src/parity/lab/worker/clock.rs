//! Explicit Tokio clock control without automatic time jumps during real I/O.

mod test;

pub(in crate::parity) struct PausedClock {
    release: Option<std::sync::mpsc::Sender<()>>,
}

impl PausedClock {
    pub async fn start() -> Self {
        let (ready, arrived) = tokio::sync::oneshot::channel();
        let (release, blocked) = std::sync::mpsc::channel();
        // Tokio inhibits automatic clock advancement while a blocking task runs.
        // The handshake proves it is running before the clock is paused.
        tokio::task::spawn_blocking(move || {
            let _ = ready.send(());
            let _ = blocked.recv();
        });
        arrived.await.expect("clock guard started");
        tokio::time::pause();
        Self {
            release: Some(release),
        }
    }

    pub async fn advance(&self, duration: std::time::Duration) {
        tokio::time::advance(duration).await;
    }
}

impl Drop for PausedClock {
    fn drop(&mut self) {
        tokio::time::resume();
        if let Some(release) = self.release.take() {
            let _ = release.send(());
        }
    }
}
