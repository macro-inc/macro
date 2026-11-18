//! Resend requests that lost their connection before a complete response.

use std::time::Duration;

use tokio_retry::{RetryIf, strategy::ExponentialBackoff};

use crate::{Result, error::OpensearchClientError};

#[cfg(test)]
mod test;

/// Delays before the second and third attempts: 100 ms, then 400 ms.
fn resend_delays() -> impl Iterator<Item = Duration> {
    ExponentialBackoff::from_millis(4).factor(25).take(2)
}

/// Run `request` (send and read the body), resending it while its connection
/// closes or refuses before a complete response. Every request this crate sends writes
/// by explicit id or by query, so a resend cannot apply twice. A timeout is
/// not resent: OpenSearch may still be working on the first attempt.
pub(crate) async fn resend_on_lost_connection<T, R, F>(request: R) -> Result<T>
where
    R: FnMut() -> F,
    F: Future<Output = Result<T>>,
{
    RetryIf::start(resend_delays(), request, |error: &OpensearchClientError| {
        let lost = error.lost_connection();
        if lost {
            tracing::warn!(%error, "OpenSearch connection lost before a complete response; resending");
        }
        lost
    })
    .await
}
