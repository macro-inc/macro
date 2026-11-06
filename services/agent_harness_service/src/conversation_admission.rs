//! Journaling a conversation message before the broker event that carried it
//! is acknowledged.

use std::time::Duration;

#[cfg(test)]
mod test;

/// How a message the journal refused is offered to it again.
#[derive(Debug, Clone, Copy)]
pub struct Retries {
    /// Attempts in all, the first included.
    pub attempts: u32,
    /// The wait before the second attempt. Each later wait doubles.
    pub first_wait: Duration,
    /// The longest any wait grows.
    pub longest_wait: Duration,
}

/// About twenty seconds of waits across six attempts: enough to ride out a
/// dropped connection or a conversation briefly busy elsewhere, without
/// holding every later event for long.
pub const ADMISSION_RETRIES: Retries = Retries {
    attempts: 6,
    first_wait: Duration::from_secs(1),
    longest_wait: Duration::from_secs(8),
};

/// Run `admit` until the journal takes the message, waiting longer after
/// each failure.
///
/// The consumer acknowledges a conversation message's event only once the
/// journal holds the message; recovery runs it from there. A failure is
/// retried here rather than ending the consumer, which would stop every
/// session this replica runs. The error of the last attempt is returned for
/// the caller to report and acknowledge, since holding the event would hold
/// every event behind it.
pub async fn journal<T, E, F>(retries: Retries, mut admit: impl FnMut() -> F) -> Result<T, E>
where
    E: std::fmt::Debug,
    F: Future<Output = Result<T, E>>,
{
    let mut wait = retries.first_wait;
    let mut attempt = 1;
    loop {
        match admit().await {
            Ok(admitted) => return Ok(admitted),
            Err(error) if attempt < retries.attempts => {
                tracing::warn!(
                    ?error,
                    attempt,
                    ?wait,
                    "could not journal a conversation message; retrying"
                );
                tokio::time::sleep(wait).await;
                wait = (wait * 2).min(retries.longest_wait);
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}
