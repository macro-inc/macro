//! Durable IMAP connection-promotion recovery scheduling.

use tokio_util::sync::CancellationToken;

/// Resume durable linking reservations after interruption without retaining passwords.
pub async fn recover<R, G, F>(
    service: email::domain::mailbox::imap_connection::ImapConnectionService<R, G, F>,
    cancellation: CancellationToken,
) where
    R: email::domain::mailbox::imap_connection::ImapConnectionRepository,
    G: email::domain::mailbox::imap_connection::ImapConnectionGateway,
    F: email::domain::mailbox::imap_connection::ImapConnectionEnrollment,
{
    use email::domain::mailbox::imap_connection::ConnectionRecoveryTick;
    loop {
        let result = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            result = service.recover_once() => result,
        };
        match result {
            Ok(ConnectionRecoveryTick::Progress) => continue,
            Ok(ConnectionRecoveryTick::Idle) => {}
            Err(error) => tracing::warn!(error = %error, "IMAP connection recovery deferred"),
        }
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {},
        }
    }
}

/// One globally leased, resumable cursor; replicas only compete for a bounded page.
pub async fn catch_up<R>(
    service: email::domain::mailbox::imap_catchup::ImapCatchupService<R>,
    cancellation: CancellationToken,
) where
    R: email::domain::mailbox::imap_catchup::ImapCatchupRepository,
{
    use email::domain::mailbox::imap_catchup::{CatchupTick, IMAP_CATCHUP_IDLE_SECONDS};
    let idle = std::time::Duration::from_secs(u64::from(IMAP_CATCHUP_IDLE_SECONDS));
    let mut requested = false;
    loop {
        if cancellation.is_cancelled() {
            return;
        }
        let delay = if !requested {
            match service.request_startup().await {
                Ok(()) => {
                    requested = true;
                    std::time::Duration::ZERO
                }
                Err(error) => {
                    tracing::warn!(%error, "IMAP startup catch-up request deferred");
                    std::time::Duration::from_secs(5)
                }
            }
        } else {
            match service.tick().await {
                Ok(CatchupTick::Busy) => idle,
                Ok(CatchupTick::Page(page)) if page.complete => idle,
                Ok(CatchupTick::Page(_)) => std::time::Duration::from_millis(50),
                Err(error) => {
                    tracing::warn!(%error, "IMAP catch-up page deferred");
                    std::time::Duration::from_secs(5)
                }
            }
        };
        // Finish the bounded page and fenced checkpoint before observing stop.
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            _ = tokio::time::sleep(delay) => {},
        }
    }
}
