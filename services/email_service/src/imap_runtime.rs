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
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            _ = interval.tick() => {},
        }
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            result = service.recover_once() => {
                if let Err(error) = result {
                    tracing::warn!(error = %error, "IMAP connection recovery deferred");
                }
            },
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
    use email::domain::mailbox::imap_catchup::CatchupTick;
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
                Ok(CatchupTick::Busy) => std::time::Duration::from_secs(5),
                Ok(CatchupTick::Page(page)) => {
                    if page.complete {
                        std::time::Duration::from_secs(5)
                    } else {
                        std::time::Duration::from_millis(50)
                    }
                }
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
