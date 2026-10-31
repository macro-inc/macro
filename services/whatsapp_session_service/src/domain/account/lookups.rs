//! Answering the owner's phone-number lookups, to start direct chats with
//! people not in the chat list.

use tracing::Instrument;
use whatsapp_linked::domain::events::LookupAnswer;

use super::{AccountExit, Running, SessionError, WhatsAppSession, survive};

impl<Session: WhatsAppSession> Running<'_, Session> {
    /// Answers the owner's pending phone-number lookups, one WhatsApp query
    /// each. Lookups wait while the connection is down and fail on their own
    /// once they expire.
    pub(super) async fn answer_lookups(&mut self) -> Result<(), AccountExit> {
        if !self.is_connected() {
            return Ok(());
        }
        let Some(lookups) = survive(
            self.sessions.pending_lookups(self.scope).await,
            "pending_lookups",
        )?
        else {
            return Ok(());
        };
        for lookup in lookups {
            let span = tracing::info_span!(
                "whatsapp.lookup",
                account_id = %self.scope.account_id,
                lookup_id = %lookup.id,
                outcome = tracing::field::Empty,
            );
            async {
                let answer = match self.session.look_up(&lookup.phone_number).await {
                    Ok(answer) => answer,
                    Err(SessionError::Fenced) => return Err(AccountExit::Fenced),
                    Err(error) => {
                        tracing::warn!(error = %error, "Looking up a WhatsApp number failed");
                        LookupAnswer::Failed
                    }
                };
                tracing::Span::current().record(
                    "outcome",
                    match &answer {
                        LookupAnswer::Found { .. } => "found",
                        LookupAnswer::NotOnWhatsApp => "not_on_whatsapp",
                        LookupAnswer::Failed => "failed",
                    },
                );
                survive(
                    self.sessions
                        .complete_lookup(self.scope, lookup.id, &answer)
                        .await,
                    "complete_lookup",
                )?;
                Ok(())
            }
            .instrument(span)
            .await?;
        }
        Ok(())
    }
}
