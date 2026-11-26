//! A saturated host trades IDLE latency for a short, bounded metadata poll.
use super::*;

impl ProtocolTransport {
    #[tracing::instrument(skip_all, name = "imap.idle.poll", fields(
        idle.poll.interval_seconds = tracing::field::Empty,
        idle.poll.capacity_busy = tracing::field::Empty,
        idle.poll.changed = tracing::field::Empty,
    ), err)]
    pub(super) async fn poll_folder(
        &self,
        credentials: &Credentials,
        committed: &FolderState,
    ) -> Result<WaitOutcome, Error> {
        tracing::Span::current().record("idle.poll.interval_seconds", 30u64);
        let read = timeout(Duration::from_secs(60), async {
            let mut session = self.command_session(credentials).await?;
            let capabilities = session
                .limit_response(ResponseLimit::Metadata)
                .capabilities()
                .await
                .map_err(|error| imap_error(error, false))?;
            let selected = if capabilities.has_str("CONDSTORE") {
                session
                    .limit_response(ResponseLimit::Metadata)
                    .select_condstore(&committed.path)
                    .await
            } else {
                session
                    .limit_response(ResponseLimit::Metadata)
                    .select(&committed.path)
                    .await
            };
            let selected = match selected {
                Ok(selected) => selected,
                Err(async_imap::error::Error::No(_) | async_imap::error::Error::Bad(_)) => {
                    return Ok(WaitOutcome::BaselineUnavailable);
                }
                Err(error) => return Err(imap_error(error, false)),
            };
            let mut changed = idle::selected_changed(committed, &selected);
            while let Ok(response) = session.unsolicited_responses.try_recv() {
                changed |= idle::unsolicited_changed(&response);
            }
            // Drop even a reusable command socket before waiting: many polling
            // accounts must not fill the fifty reserved slots with idle spares.
            drop(session);
            Ok(if changed {
                WaitOutcome::Changed
            } else {
                WaitOutcome::Restarted
            })
        })
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
        let outcome = match read {
            Err(Error::AccountBusy) => {
                tracing::Span::current().record("idle.poll.capacity_busy", true);
                WaitOutcome::Restarted
            }
            result => result?,
        };
        tracing::Span::current().record("idle.poll.changed", outcome == WaitOutcome::Changed);
        if outcome == WaitOutcome::Restarted {
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
        Ok(outcome)
    }
}
