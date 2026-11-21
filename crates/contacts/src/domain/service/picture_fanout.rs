use crate::domain::models::page::{ContactCursor, ContactPageSize};
use crate::domain::ports::{ContactListReader, ContactsPageRepository, UserPictureNotifier};
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
///
/// While the `contacts-list-reads` flag ramps, each recipient's directory comes
/// from the legacy graph or the list-aware tables, and nothing tells the
/// fan-out which. It notifies both audiences, so a recipient whose directory
/// has the user under either store hears of it; one in both is notified twice
/// and refetches the picture twice.
pub struct UserPictureFanout<R, N> {
    repository: R,
    notifier: N,
}

/// Which audience a fan-out pass reads.
#[derive(Clone, Copy)]
enum Audience {
    /// The user's legacy graph neighbors (undirected, so also who has them).
    Legacy,
    /// Who has the user in their list-aware directory.
    Lists,
}

impl<R: ContactsPageRepository + ContactListReader, N: UserPictureNotifier>
    UserPictureFanout<R, N>
{
    /// Build the fan-out over paged contact readers and a notifier.
    pub fn new(repository: R, notifier: N) -> Self {
        Self {
            repository,
            notifier,
        }
    }

    /// Notify everyone who has `user_id` in their directory (including
    /// themselves), under either store.
    ///
    /// Reads only indexed, bounded id pages and sends one gateway message per
    /// page, so memory and query cost stay constant however large the
    /// audience is. A failed page aborts with an error; the caller may retry,
    /// which re-notifies earlier pages harmlessly (clients just refetch).
    pub async fn fan_out(&self, user_id: &MacroUserIdStr<'_>) -> Result<FanoutSummary, Report> {
        let span = tracing::info_span!(
            "contacts.user_picture_fanout",
            pages = tracing::field::Empty,
            recipients = tracing::field::Empty,
            outcome = tracing::field::Empty,
        );
        let result = self.fan_out_both(user_id).instrument(span.clone()).await;
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

    async fn fan_out_both(&self, user_id: &MacroUserIdStr<'_>) -> Result<FanoutSummary, Report> {
        let legacy = self.fan_out_pages(user_id, Audience::Legacy).await?;
        let lists = self.fan_out_pages(user_id, Audience::Lists).await?;
        Ok(FanoutSummary {
            pages: legacy.pages + lists.pages,
            recipients: legacy.recipients + lists.recipients,
        })
    }

    async fn fan_out_pages(
        &self,
        user_id: &MacroUserIdStr<'_>,
        audience: Audience,
    ) -> Result<FanoutSummary, Report> {
        let mut summary = FanoutSummary::default();
        let mut cursor: Option<ContactCursor> = None;
        loop {
            let page = match audience {
                Audience::Legacy => {
                    self.repository
                        .contact_id_page(user_id.copied(), cursor.as_ref(), FANOUT_PAGE_SIZE)
                        .await?
                }
                Audience::Lists => {
                    self.repository
                        .audience_page(user_id.copied(), cursor.as_ref(), FANOUT_PAGE_SIZE)
                        .await?
                }
            };
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
