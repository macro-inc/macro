use std::future::Future;
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod test;

/// Waits for an operation unless worker shutdown is requested first.
///
/// Cancellation is polled first so an already-cancelled worker does not begin
/// another receive or restart wait.
pub(crate) async fn run_until_cancelled<F>(
    cancellation_token: &CancellationToken,
    operation: F,
) -> Option<F::Output>
where
    F: Future,
{
    tokio::select! {
        biased;
        _ = cancellation_token.cancelled() => None,
        output = operation => Some(output),
    }
}
