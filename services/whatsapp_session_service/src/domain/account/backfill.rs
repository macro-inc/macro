//! Importing earlier messages of the owner's added chats from the phone, a
//! page at a time.

use external_chat::domain::models::BackfillState;
use tracing::Instrument;
use whatsapp_linked::domain::events::{BackfillWork, HistoryPage};

use super::{AccountExit, BACKFILL_PAGE, Running, SessionError, WhatsAppSession, survive};

impl<Session: WhatsAppSession> Running<'_, Session> {
    /// Continues imports the owner started: asks for the next page of every
    /// chat with none outstanding, and marks a request the phone left
    /// unanswered for [`AccountConfig::backfill_timeout`] as waiting for the
    /// phone. Never asks the phone on its own: each request wakes WhatsApp on
    /// the phone (on iOS, a "syncing stopped" notification when it can't
    /// finish), so only the owner's Import starts one.
    pub(super) async fn backfill(&mut self) -> Result<(), AccountExit> {
        if !self.is_connected() {
            return Ok(());
        }
        let Some(work) = survive(
            self.sessions.backfill_work(self.scope).await,
            "backfill_work",
        )?
        else {
            return Ok(());
        };
        let now = chrono::Utc::now();
        for group in work {
            let unanswered = group.requested_at.map(|at| {
                (now - at)
                    .to_std()
                    .is_ok_and(|elapsed| elapsed >= self.config.backfill_timeout)
            });
            match (group.state, unanswered) {
                (BackfillState::Running, Some(true)) => {
                    tracing::info!(
                        account_id = %self.scope.account_id,
                        chat_id = %group.chat_id,
                        "The phone did not answer a history request; the owner can start it again"
                    );
                    survive(
                        self.sessions
                            .backfill_unanswered(self.scope, group.chat_id)
                            .await,
                        "backfill_unanswered",
                    )?;
                }
                (BackfillState::Running, Some(false)) => {}
                (BackfillState::Pending | BackfillState::Running, None) => {
                    Box::pin(self.request_page(&group)).await?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Asks the phone for the page before the group's cursor (first: before
    /// the chat's newest message, which is asked for itself when it came
    /// before the group was added and so was not kept).
    pub(super) async fn request_page(&mut self, group: &BackfillWork) -> Result<(), AccountExit> {
        let Some(before) = group.cursor.as_ref().or(group.anchor.as_ref()) else {
            // No message known in this chat yet: the first one starts it.
            if group.state != BackfillState::WaitingForMessage {
                survive(
                    self.sessions
                        .backfill_waiting_for_message(self.scope, group.chat_id)
                        .await,
                    "backfill_waiting_for_message",
                )?;
            }
            return Ok(());
        };
        let span = tracing::info_span!(
            "whatsapp.backfill.request",
            account_id = %self.scope.account_id,
            chat_id = %group.chat_id,
            imported = group.imported,
            first = group.cursor.is_none(),
            outcome = tracing::field::Empty,
        );
        async {
            let first = group.cursor.is_none();
            if first
                && before.at <= group.adopted_at + chrono::Duration::seconds(10)
                && let Err(error) = self.session.request_message(&group.group_jid, before).await
            {
                tracing::warn!(error = %error, "Asking the phone for a chat's newest message failed");
            }
            match self
                .session
                .request_history(&group.group_jid, before, BACKFILL_PAGE)
                .await
            {
                Ok(()) => {
                    tracing::Span::current().record("outcome", "requested");
                    survive(
                        self.sessions
                            .backfill_requested(self.scope, group.chat_id)
                            .await,
                        "backfill_requested",
                    )?;
                }
                Err(SessionError::Fenced) => return Err(AccountExit::Fenced),
                Err(error) => {
                    tracing::Span::current().record("outcome", "send_failed");
                    tracing::warn!(error = %error, "Asking the phone for earlier messages failed");
                }
            }
            Ok(())
        }
        .instrument(span)
        .await
    }

    /// The phone answered with a page: record it, then ask for the next one.
    pub(super) async fn history_page(&mut self, page: &HistoryPage) -> Result<(), AccountExit> {
        // The page's messages were queued first; ingest them before counting.
        self.replay().await?;
        let states = survive(
            self.sessions.backfill_page(self.scope, page).await,
            "backfill_page",
        )?
        .unwrap_or_default();
        if states
            .iter()
            .any(|(_, state)| *state == BackfillState::Running)
        {
            Box::pin(self.backfill()).await?;
        }
        Ok(())
    }
}
