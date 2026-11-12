use std::{
    future::{Future, pending},
    io,
};

#[cfg(test)]
mod test;

async fn wait_for_signal_listener<F>(listener: F, signal: &'static str)
where
    F: Future<Output = io::Result<()>>,
{
    match listener.await {
        Ok(()) => {}
        Err(error) => {
            tracing::error!(error=?error, signal, "failed to install shutdown signal listener");
            pending::<()>().await;
        }
    }
}

async fn wait_for_shutdown_signals<CtrlC, Terminate>(ctrl_c: CtrlC, terminate: Terminate)
where
    CtrlC: Future<Output = io::Result<()>>,
    Terminate: Future<Output = io::Result<()>>,
{
    tokio::select! {
        _ = wait_for_signal_listener(ctrl_c, "Ctrl+C") => {}
        _ = wait_for_signal_listener(terminate, "SIGTERM") => {}
    }
}

#[cfg(unix)]
async fn terminate_signal() -> io::Result<()> {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;

    match terminate.recv().await {
        Some(()) => Ok(()),
        None => pending().await,
    }
}

/// Waits for Ctrl+C on all platforms or SIGTERM on Unix.
///
/// A listener installation error is logged and leaves that listener pending so it cannot be
/// mistaken for a shutdown signal.
pub async fn shutdown_signal() {
    let ctrl_c = tokio::signal::ctrl_c();

    #[cfg(unix)]
    let terminate = terminate_signal();

    #[cfg(not(unix))]
    let terminate = pending::<io::Result<()>>();

    wait_for_shutdown_signals(ctrl_c, terminate).await;
    tracing::info!("shutdown signal received");
}
