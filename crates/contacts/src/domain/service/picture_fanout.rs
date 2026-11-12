use crate::domain::models::page::{ContactCursor, ContactPageSize};
use crate::domain::ports::{ContactsPageRepository, UserPictureNotifier};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::{Report, report};
use std::collections::HashSet;
use tracing::Instrument as _;

#[cfg(test)]
mod test;

/// Recipients per gateway message: the largest bounded contact page.
const FANOUT_PAGE_SIZE: ContactPageSize = ContactPageSize::MAX;

/// What one fan-out reached.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FanoutSummary {
    /// Contact pages read.
    pub pages: u32,
    /// Contacts (including the user) notified.
    pub recipients: u64,
}

/// Drop repeated users, keeping first-seen order. The event carries no state
/// beyond the user id (clients refetch the current picture), so the latest
/// event for a user needs no more than one fan-out.
pub fn coalesce_users(
    users: impl IntoIterator<Item = MacroUserIdStr<'static>>,
) -> Vec<MacroUserIdStr<'static>> {
    let mut seen = HashSet::new();
    users
        .into_iter()
        .filter(|user| seen.insert(user.as_ref().to_string()))
        .collect()
}

/// Tells a user's contacts, page by page, that the user's picture changed.
pub struct UserPictureFanout<R, N> {
    repository: R,
    notifier: N,
}

impl<R: ContactsPageRepository, N: UserPictureNotifier> UserPictureFanout<R, N> {
    /// Build the fan-out over a paged contact reader and a notifier.
    pub fn new(repository: R, notifier: N) -> Self {
        Self {
            repository,
            notifier,
        }
    }

    /// Notify every contact of `user_id` (including themselves).
    ///
    /// Reads only the indexed, bounded contact-ID pages and sends one gateway
    /// message per page, so memory and query cost stay constant however large
    /// the contact list is. A failed page aborts with an error; the caller may
    /// retry, which re-notifies earlier pages harmlessly (clients just refetch).
    pub async fn fan_out(&self, user_id: &MacroUserIdStr<'_>) -> Result<FanoutSummary, Report> {
        let span = tracing::info_span!(
            "contacts.user_picture_fanout",
            user_id = %user_id.as_ref(),
            pages = tracing::field::Empty,
            recipients = tracing::field::Empty,
            outcome = tracing::field::Empty,
        );
        let result = self.fan_out_pages(user_id).instrument(span.clone()).await;
        match &result {
            Ok(summary) => {
                span.record("pages", summary.pages);
                span.record("recipients", summary.recipients);
                span.record("outcome", "ok");
            }
            Err(error) => {
                span.record("outcome", "error");
                tracing::error!(parent: &span, error = ?error, "user picture fan-out failed");
            }
        }
        result
    }

    async fn fan_out_pages(&self, user_id: &MacroUserIdStr<'_>) -> Result<FanoutSummary, Report> {
        let mut summary = FanoutSummary::default();
        let mut cursor: Option<ContactCursor> = None;
        loop {
            let page = self
                .repository
                .contact_id_page(user_id.copied(), cursor.as_ref(), FANOUT_PAGE_SIZE)
                .await?;
            summary.pages += 1;
            // A page can be empty yet continue (skipped malformed legacy IDs).
            if !page.contacts.is_empty() {
                let recipients: Vec<_> = page.contacts.into_iter().map(|e| e.user_id).collect();
                self.notifier
                    .notify_picture_changed(user_id, &recipients)
                    .await?;
                summary.recipients += recipients.len() as u64;
            }
            match page.next_cursor {
                None => return Ok(summary),
                Some(next) if cursor.as_ref() == Some(&next) => {
                    return Err(report!("contact page cursor did not advance"));
                }
                Some(next) => cursor = Some(next),
            }
        }
    }
}
