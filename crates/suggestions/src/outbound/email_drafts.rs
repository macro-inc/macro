//! A person's email drafts, as the email domain's repository keeps them.

use email::domain::models::MessageRow;
use email::domain::ports::EmailRepo;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use crate::domain::model::preview_of;
use crate::domain::ports::{FoundDraft, SuggestionDrafts};

#[cfg(test)]
mod test;

/// How many of a thread's newest messages are read for a draft's text: one
/// written just now is the newest, and a draft not among them gets no preview.
const NEWEST_MESSAGES: i64 = 3;

/// [`SuggestionDrafts`] through the email domain's [`EmailRepo`].
pub struct EmailSuggestionDrafts<R>(pub R);

impl<R> SuggestionDrafts for EmailSuggestionDrafts<R>
where
    R: EmailRepo,
    R::Err: std::error::Error + Sync + 'static,
{
    type Err = R::Err;

    async fn email_draft(
        &self,
        user: &MacroUserIdStr<'_>,
        draft: Uuid,
    ) -> Result<Option<FoundDraft>, Self::Err> {
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
        let Some(thread) = self
            .0
            .get_simple_message(draft, &own)
            .await?
            .filter(|message| message.is_draft && !message.is_sent)
            .map(|message| message.thread_db_id)
        else {
            return Ok(None);
        };
        let preview = self
            .0
            .messages_by_thread_id_paginated(thread, 0, NEWEST_MESSAGES)
            .await?
            .into_iter()
            .find(|message| message.db_id == draft)
            .and_then(|message| text_of(&message));
        Ok(Some(FoundDraft { thread, preview }))
    }
}

/// The start of `message`'s plain text: its text body, else its HTML body's
/// text, else its snippet.
fn text_of(message: &MessageRow) -> Option<String> {
    message
        .body_text
        .as_deref()
        .and_then(preview_of)
        .or_else(|| {
            message
                .body_html_sanitized
                .as_deref()
                .and_then(email_utils::body_parsed::html_to_undecorated_text)
                .as_deref()
                .and_then(preview_of)
        })
        .or_else(|| message.snippet.as_deref().and_then(preview_of))
}
