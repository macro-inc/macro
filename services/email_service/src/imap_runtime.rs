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
