//! A person's email drafts, as the email domain's repository keeps them.

use email::domain::ports::EmailRepo;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use crate::domain::ports::SuggestionDrafts;

#[cfg(test)]
mod test;

/// [`SuggestionDrafts`] through the email domain's [`EmailRepo`].
pub struct EmailSuggestionDrafts<R>(pub R);

impl<R> SuggestionDrafts for EmailSuggestionDrafts<R>
where
    R: EmailRepo,
    R::Err: std::error::Error + Sync + 'static,
{
    type Err = R::Err;

    async fn email_draft_thread(
        &self,
        user: &MacroUserIdStr<'_>,
        draft: Uuid,
    ) -> Result<Option<Uuid>, Self::Err> {
        // Only the person's own inboxes: an inbox delegated to them is
        // someone else's mail.
        let own: Vec<Uuid> = self
            .0
            .inboxes_for_macro_id(user.clone())
            .await?
            .into_iter()
            .filter(|link| link.macro_id == *user)
            .map(|link| link.id)
            .collect();
        if own.is_empty() {
            return Ok(None);
        }
        Ok(self
            .0
            .get_simple_message(draft, &own)
            .await?
            .filter(|message| message.is_draft && !message.is_sent)
            .map(|message| message.thread_db_id))
    }
}
